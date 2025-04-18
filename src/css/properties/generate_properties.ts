type VendorPrefixes = "none" | "webkit" | "moz" | "ms" | "o";

type LogicalGroup =
  | "border_color"
  | "border_style"
  | "border_width"
  | "border_radius"
  | "margin"
  | "scroll_margin"
  | "padding"
  | "scroll_padding"
  | "inset"
  | "size"
  | "min_size"
  | "max_size";

type PropertyCategory = "logical" | "physical";

type PropertyDef = {
  ty: string;
  shorthand?: boolean;
  valid_prefixes?: VendorPrefixes[];
  logical_group?: {
    ty: LogicalGroup;
    category: PropertyCategory;
  };
  /// By default true
  unprefixed?: boolean;
  conditional?: {
    css_modules: boolean;
  };
  eval_branch_quota?: number;
  /**
   * If parsing a property fails, we fallback to parsing it as `UnparsedProperty`. This is just
   * the raw tokens. This is helpful for certain minify property handlers.
   *
   * In other cases, it's more helpful to throw an error. For example, if the `composes` property,
   * is used incorrectly, it is more useful for the user to know about that error.
   */
  parse_dont_make_unparsed?: boolean;
};

const OUTPUT_FILE = "src/css/properties/properties_generated.zig";

async function generateCode(property_defs: Record<string, PropertyDef>) {
  const EMIT_COMPLETED_MD_FILE = true;
  if (EMIT_COMPLETED_MD_FILE) {
    const completed = Object.entries(property_defs)
      .map(([name, meta]) => `- [x] \`${name}\``)
      .join("\n");
    await Bun.$`echo ${completed} > completed.md`;
  }
  await Bun.$`echo ${prelude()} > ${OUTPUT_FILE}`;
  await Bun.$`echo ${generateProperty(property_defs)} >> ${OUTPUT_FILE}`;
  await Bun.$`echo ${generatePropertyId(property_defs)} >> ${OUTPUT_FILE}`;
  await Bun.$`echo ${generatePropertyIdTag(property_defs)} >> ${OUTPUT_FILE}`;
  await Bun.$`vendor/zig/zig.exe fmt ${OUTPUT_FILE}`;
}

function generatePropertyIdTag(property_defs: Record<string, PropertyDef>): string {
  return `pub const PropertyIdTag = enum(u16) {
  ${Object.keys(property_defs)
    .map(key => `${escapeIdent(key)},`)
    .join("\n")}
    all,
    unparsed,
    custom,

    /// Helper function used in comptime code to know whether to access the underlying value
    /// with tuple indexing syntax because it may have a VendorPrefix associated with it.
    pub fn hasVendorPrefix(this: PropertyIdTag) bool {
      return switch (this) {
        ${Object.entries(property_defs)
          .map(([name, meta]) => `.${escapeIdent(name)} => ${meta.valid_prefixes === undefined ? "false" : "true"},`)
          .join("\n")}
        .unparsed => false,
        .custom => false,
        .all => false,
      };
    }

    /// Helper function used in comptime code to know whether to access the underlying value
    /// with tuple indexing syntax because it may have a VendorPrefix associated with it.
    pub fn valueType(this: PropertyIdTag) type {
      return switch (this) {
        ${Object.entries(property_defs)
          .map(([name, meta]) => `.${escapeIdent(name)} => ${meta.ty},`)
          .join("\n")}
        .all => CSSWideKeyword,
        .unparsed => UnparsedProperty,
        .custom => CustomProperty,
      };
    }
};`;
}

function generateProperty(property_defs: Record<string, PropertyDef>): string {
  return `pub const Property = union(PropertyIdTag) {
${Object.entries(property_defs)
  .map(([name, meta]) => generatePropertyField(name, meta))
  .join("\n")}
  all: CSSWideKeyword,
  unparsed: UnparsedProperty,
  custom: CustomProperty,

  ${generatePropertyImpl(property_defs)}
};`;
}

function generatePropertyImpl(property_defs: Record<string, PropertyDef>): string {
  const required_functions = ["deepClone", "parse", "toCss", "eql"];

  return `
  // Copy manually implemented functions.
  pub const toCss = properties_impl.property_mixin.toCss

  // Sanity check to make sure all types have the following functions:
  // - deepClone()
  // - eql()
  // - parse()
  // - toCss()
  // 
  // We do this string concatenation thing so we get all the errors at once,
  // instead of relying on Zig semantic analysis which usually stops at the first error.
  comptime {
  const compile_error: []const u8 = compile_error: {
      var compile_error: []const u8 = "";
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          if (meta.ty != "void" && meta.ty != "CSSNumber" && meta.ty != "CSSInteger") {
            return required_functions
              .map(
                fn => `
            if (!@hasDecl(${meta.ty}, "${fn}")) {
              compile_error = compile_error ++ @typeName(${meta.ty}) ++ ": does not have a ${fn}() function.\\n";
            }
            `,
              )
              .join("\n");
          }
          return "";
        })
        .join("\n")}
      const final_compile_error = compile_error;
      break :compile_error final_compile_error;
    };
    if (compile_error.len > 0) {
      @compileError(compile_error);
    }
  }

  /// Parses a CSS property by name.
  pub fn parse(property_id: PropertyId, input: *css.Parser, options: *const css.ParserOptions) Result(Property) {
    const state = input.state();

    switch (property_id) {
      ${generatePropertyImplParseCases(property_defs)}
      .all => return .{ .result = .{ .all = switch (CSSWideKeyword.parse(input)) {
        .result => |v| v,
        .err => |e| return .{ .err = e },
      } } },
      .custom => |name| return .{ .result = .{ .custom = switch (CustomProperty.parse(name, input, options)) {
        .result => |v| v,
        .err => |e| return .{ .err = e },
      } } },
      else => {},
    }

    // If a value was unable to be parsed, treat as an unparsed property.
    // This is different from a custom property, handled below, in that the property name is known
    // and stored as an enum rather than a string. This lets property handlers more easily deal with it.
    // Ideally we'd only do this if var() or env() references were seen, but err on the safe side for now.
    input.reset(&state);
    return .{ .result = .{ .unparsed = switch (UnparsedProperty.parse(property_id, input, options)) {
    .result => |v| v,
    .err => |e| return .{ .err = e },
    } } };
  }

  pub fn propertyId(this: *const Property) PropertyId {
    return switch (this.*) {
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          if (meta.valid_prefixes !== undefined) {
            return `.${escapeIdent(name)} => |*v| PropertyId{ .${escapeIdent(name)} = v[1]  },`;
          }
          return `.${escapeIdent(name)} => .${escapeIdent(name)},`;
        })
        .join("\n")}
      .all => PropertyId.all,
      .unparsed => |unparsed| unparsed.property_id,
      .custom => |c| .{ .custom = c.name },
    };
  }

  pub fn deepClone(this: *const Property, allocator: std.mem.Allocator) Property {
    return switch (this.*) {
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          if (meta.valid_prefixes !== undefined) {
            const clone_expr =
              meta.ty === "CSSNumber" || meta.ty === "CSSInteger" ? "v[0]" : "v[0].deepClone(allocator)";
            return `.${escapeIdent(name)} => |*v| .{ .${escapeIdent(name)} = .{ ${clone_expr}, v[1] } },`;
          }
          const clone_expr =
            meta.ty === "CSSNumber" || meta.ty === "CSSInteger"
              ? "v.*"
              : meta.ty.includes("BabyList(")
                ? `css.generic.deepClone(${meta.ty}, v, allocator)`
                : "v.deepClone(allocator)";
          return `.${escapeIdent(name)} => |*v| .{ .${escapeIdent(name)} = ${clone_expr} },`;
        })
        .join("\n")}
      .all => |*a| return .{ .all = a.deepClone(allocator) },
      .unparsed => |*u| return .{ .unparsed = u.deepClone(allocator) },
      .custom => |*c| return .{ .custom = c.deepClone(allocator) },
    };
  }

  /// We're going to have this empty for now since not every property has a deinit function.
  /// It's not strictly necessary since all allocations are into an arena.
  /// It's mostly intended as a performance optimization in the case where mimalloc arena is used,
  /// since it can reclaim the memory and use it for subsequent allocations.
  /// I haven't benchmarked that though, so I don't actually know how much faster it would actually make it.
  pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
      _ = this;
      _ = allocator;
  }

  pub inline fn __toCssHelper(this: *const Property) struct{[]const u8, VendorPrefix} {
    return switch (this.*) {
      ${generatePropertyImplToCssHelper(property_defs)}
      .all => .{ "all", VendorPrefix{ .none = true } },
      .unparsed => |*unparsed| brk: {
        var prefix = unparsed.property_id.prefix();
        if (prefix.isEmpty()) {
          prefix = VendorPrefix{ .none = true };
        }
        break :brk .{ unparsed.property_id.name(), prefix };
      },
      .custom => unreachable,
    };
  }

  /// Serializes the value of a CSS property without its name or \`!important\` flag.
  pub fn valueToCss(this: *const Property, comptime W: type, dest: *css.Printer(W)) PrintErr!void {
    return switch(this.*) {
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          const value = meta.valid_prefixes === undefined ? "value" : "value[0]";
          const to_css =
            meta.ty === "CSSNumber"
              ? `CSSNumberFns.toCss(&${value}, W, dest)`
              : meta.ty === "CSSInteger"
                ? `CSSIntegerFns.toCss(&${value}, W, dest)`
                : meta.ty.includes("ArrayList")
                  ? `css.generic.toCss(${meta.ty}, ${value}, W, dest)`
                  : `${value}.toCss(W, dest)`;
          return `.${escapeIdent(name)} => |*value| ${to_css},`;
        })
        .join("\n")}
      .all => |*keyword| keyword.toCss(W, dest),
      .unparsed => |*unparsed| unparsed.value.toCss(W, dest, false),
      .custom => |*c| c.value.toCss(W, dest, c.name == .custom),
    };
  }

  /// Returns the given longhand property for a shorthand.
  pub fn longhand(this: *const Property, property_id: *const PropertyId) ?Property {
    switch (this.*) {
      ${Object.entries(property_defs)
        .filter(([_, meta]) => meta.shorthand)
        .map(([name, meta]) => {
          if (meta.valid_prefixes !== undefined) {
            return `.${escapeIdent(name)} => |*v| {
              if (!v[1].eq(property_id.prefix())) return null;
              return v[0].longhand(property_id);
            },`;
          }

          return `.${escapeIdent(name)} => |*v| return v.longhand(property_id),`;
        })
        .join("\n")}
      else => {},
    }
    return null;
  }

  pub fn eql(lhs: *const Property, rhs: *const Property) bool {
    if (@intFromEnum(lhs.*) != @intFromEnum(rhs.*)) return false;
    return switch (lhs.*) {
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          if (meta.valid_prefixes !== undefined)
            return `.${escapeIdent(name)} => |*v| css.generic.eql(${meta.ty}, &v[0], &rhs.${escapeIdent(name)}[0]) and v[1].eq(rhs.${escapeIdent(name)}[1]),`;
          return `.${escapeIdent(name)} => |*v| css.generic.eql(${meta.ty}, v, &rhs.${escapeIdent(name)}),`;
        })
        .join("\n")}
      .unparsed => |*u| u.eql(&rhs.unparsed),
      .all => true,
      .custom => |*c| c.eql(&rhs.custom),
    };
  }
`;
}

function generatePropertyImplToCssHelper(property_defs: Record<string, PropertyDef>): string {
  return Object.entries(property_defs)
    .map(([name, meta]) => {
      const capture = meta.valid_prefixes === undefined ? "" : "|*x|";
      const prefix = meta.valid_prefixes === undefined ? "VendorPrefix{ .none = true }" : 'x.@"1"';
      return `.${escapeIdent(name)} => ${capture} .{"${name}", ${prefix}},`;
    })
    .join("\n");
}

function generatePropertyImplParseCases(property_defs: Record<string, PropertyDef>): string {
  return Object.entries(property_defs)
    .map(([name, meta]) => {
      const capture = meta.valid_prefixes === undefined ? "" : "|pre|";
      const ret =
        meta.valid_prefixes === undefined
          ? `.{ .${escapeIdent(name)} = c }`
          : `.{ .${escapeIdent(name)} = .{ c, pre } }`;
      if (meta.parse_dont_make_unparsed === true) {
        return `.${escapeIdent(name)} => ${capture} {
    ${meta.eval_branch_quota !== undefined ? `@setEvalBranchQuota(${meta.eval_branch_quota});` : ""}
  return switch (css.generic.parseWithOptions(${meta.ty}, input, options)) {
    .result => |c| return .{ .result = ${ret} },
    .err => |e| return .{ .err = e },
  };
},`;
      }
      return `.${escapeIdent(name)} => ${capture} {
    ${meta.eval_branch_quota !== undefined ? `@setEvalBranchQuota(${meta.eval_branch_quota});` : ""}
  if (css.generic.parseWithOptions(${meta.ty}, input, options).asValue()) |c| {
    if (input.expectExhausted().isOk()) {
      return .{ .result = ${ret} };
    }
  }
},`;
    })
    .join("\n");
}

function generatePropertyField(name: string, meta: PropertyDef): string {
  if (meta.valid_prefixes !== undefined) {
    return ` ${escapeIdent(name)}: struct{ ${meta.ty}, VendorPrefix },`;
  }
  return ` ${escapeIdent(name)}: ${meta.ty},`;
}

function generatePropertyId(property_defs: Record<string, PropertyDef>): string {
  return `pub const PropertyId = union(PropertyIdTag) {
${Object.entries(property_defs)
  .map(([name, meta]) => generatePropertyIdField(name, meta))
  .join("\n")}
  all,
  unparsed,
  custom: CustomPropertyName,

  // Copy manually implemented functions.
  pub const toCss = properties_impl.property_id_mixin.toCss;
  pub const parse = properties_impl.property_id_mixin.toCss;
  pub const fromString = properties_impl.property_id_mixin.toCss;
  pub const fromStr = fromString;

${generatePropertyIdImpl(property_defs)}
};`;
}

function generatePropertyIdField(name: string, meta: PropertyDef): string {
  if (meta.valid_prefixes !== undefined) {
    return ` ${escapeIdent(name)}: VendorPrefix,`;
  }
  return ` ${escapeIdent(name)},`;
}

function generatePropertyIdImpl(property_defs: Record<string, PropertyDef>): string {
  return `
  /// Returns the property name, without any vendor prefixes.
  pub inline fn name(this: *const PropertyId) []const u8 {
      if (this.* == .custom) return this.custom.asStr();
      return @tagName(this.*);
  }

  /// Returns the vendor prefix for this property id.
  pub fn prefix(this: *const PropertyId) VendorPrefix {
    return switch (this.*) {
      ${generatePropertyIdImplPrefix(property_defs)}
      .all, .custom, .unparsed => VendorPrefix{},
    };
  }

  pub fn fromNameAndPrefix(name1: []const u8, pre: VendorPrefix) ?PropertyId {
    const Enum = enum { ${Object.entries(property_defs)
      .map(
        ([prop_name, def], i) => `${escapeIdent(prop_name)}${i === Object.keys(property_defs).length - 1 ? "" : ", "}`,
      )
      .join("")} };
    const Map = comptime bun.ComptimeEnumMap(Enum);
    if (Map.getASCIIICaseInsensitive(name1)) |prop| {
      switch (prop) {
        ${Object.entries(property_defs).map(([name, meta]) => {
          return `.${escapeIdent(name)} => {
            const allowed_prefixes = ${constructVendorPrefix(meta.valid_prefixes)};
            if (allowed_prefixes.contains(pre)) return ${meta.valid_prefixes === undefined ? `.${escapeIdent(name)}` : `.{ .${escapeIdent(name)} = pre }`};
          }`;
        })}
      }
    }

    return null;
  }

  pub fn withPrefix(this: *const PropertyId, pre: VendorPrefix) PropertyId {
    return switch (this.*) {
      ${Object.entries(property_defs)
        .map(([prop_name, def]) => {
          if (def.valid_prefixes === undefined) return `.${escapeIdent(prop_name)} => .${escapeIdent(prop_name)},`;
          return `.${escapeIdent(prop_name)} => .{ .${escapeIdent(prop_name)} = pre },`;
        })
        .join("\n")}
      else => this.*,
    };
  }

  pub fn addPrefix(this: *PropertyId, pre: VendorPrefix) void {
    return switch (this.*) {
      ${Object.entries(property_defs)
        .map(([prop_name, def]) => {
          if (def.valid_prefixes === undefined) return `.${escapeIdent(prop_name)} => {},`;
          return `.${escapeIdent(prop_name)} => |*p| { p.insert(pre); },`;
        })
        .join("\n")}
      else => {},
    };
  }

  pub inline fn deepClone(this: *const PropertyId, _: std.mem.Allocator) PropertyId {
    return this.*;
  }

  pub fn eql(lhs: *const PropertyId, rhs: *const PropertyId) bool {
    if (@intFromEnum(lhs.*) != @intFromEnum(rhs.*)) return false;
    inline for (bun.meta.EnumFields(PropertyId), std.meta.fields(PropertyId)) |enum_field, union_field| {
      if (enum_field.value == @intFromEnum(lhs.*)) {
        if (comptime union_field.type == css.VendorPrefix) {
          return @field(lhs, union_field.name).eql(@field(rhs, union_field.name));
        } else {
          return true;
        }
      }
    }
    unreachable;
  }

  pub fn hash(this: *const PropertyId, hasher: *std.hash.Wyhash) void {
    const tag = @intFromEnum(this.*);
    hasher.update(std.mem.asBytes(&tag));
  }

  pub fn setPrefixesForTargets(this: *PropertyId, targets: Targets) void {
    switch (this.*) {
      ${Object.entries(property_defs)
        .map(([name, meta]) => {
          if (meta.unprefixed === false || meta.valid_prefixes === undefined) return `.${escapeIdent(name)} => {},`;
          return `.${escapeIdent(name)} => |*x| {
            x.* = targets.prefixes(x.*, Feature.${featureName(name)});
          },
          `;
        })
        .join("\n")}
      else => {},
    }
  }
`;
}

function generatePropertyIdImplPrefix(property_defs: Record<string, PropertyDef>): string {
  return Object.entries(property_defs)
    .map(([name, meta]) => {
      if (meta.valid_prefixes === undefined) return `.${escapeIdent(name)} => VendorPrefix{},`;
      return `.${escapeIdent(name)} => |p| p,`;
    })
    .join("\n");
}

// TODO: todo_stuff.match_ignore_ascii_case
function generatePropertyIdImplFromNameAndPrefix(property_defs: Record<string, PropertyDef>): string {
  return Object.entries(property_defs)
    .map(([name, meta]) => {
      if (name === "unparsed") return "";
      return `if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name1, "${name}")) {
  const allowed_prefixes = ${constructVendorPrefix(meta.valid_prefixes)};
  if (allowed_prefixes.contains(pre)) return ${meta.valid_prefixes === undefined ? `.${escapeIdent(name)}` : `.{ .${escapeIdent(name)} = pre }`};
} else `;
    })
    .join("\n");
}

function constructVendorPrefix(prefixes: VendorPrefixes[] | undefined): string {
  if (prefixes === undefined) return `VendorPrefix{ .none = true }`;
  return `VendorPrefix{ ${[`.none = true`, ...prefixes.map(prefix => `.${prefix} = true`)].join(", ")} }`;
}

function needsEscaping(name: string): boolean {
  switch (name) {
    case "align":
      return true;
    case "var":
    default: {
      return ["-", "(", ")", " ", ":", ";", ","].some(c => name.includes(c));
    }
  }
}

function escapeIdent(name: string): string {
  if (needsEscaping(name)) {
    return `@"${name}"`;
  }
  return name;
}

generateCode({
  "background-color": {
    ty: "CssColor",
  },
  "background-image": {
    ty: "SmallList(Image, 1)",
  },
  "background-position-x": {
    ty: "SmallList(css_values.position.HorizontalPosition, 1)",
  },
  "background-position-y": {
    ty: "SmallList(css_values.position.VerticalPosition, 1)",
  },
  "background-position": {
    ty: "SmallList(background.BackgroundPosition, 1)",
    shorthand: true,
  },
  "background-size": {
    ty: "SmallList(background.BackgroundSize, 1)",
  },
  "background-repeat": {
    ty: "SmallList(background.BackgroundRepeat, 1)",
  },
  "background-attachment": {
    ty: "SmallList(background.BackgroundAttachment, 1)",
  },
  "background-clip": {
    ty: "SmallList(background.BackgroundClip, 1)",
    valid_prefixes: ["webkit", "moz"],
  },
  "background-origin": {
    ty: "SmallList(background.BackgroundOrigin, 1)",
  },
  background: {
    ty: "SmallList(background.Background, 1)",
  },
  "box-shadow": {
    ty: "SmallList(box_shadow.BoxShadow, 1)",
    valid_prefixes: ["webkit", "moz"],
  },
  opacity: {
    ty: "css.css_values.alpha.AlphaValue",
  },
  color: {
    ty: "CssColor",
  },
  display: {
    ty: "display.Display",
  },
  visibility: {
    ty: "display.Visibility",
  },
  width: {
    ty: "size.Size",
    logical_group: { ty: "size", category: "physical" },
  },
  height: {
    ty: "size.Size",
    logical_group: { ty: "size", category: "physical" },
  },
  "min-width": {
    ty: "size.Size",
    logical_group: { ty: "min_size", category: "physical" },
  },
  "min-height": {
    ty: "size.Size",
    logical_group: { ty: "min_size", category: "physical" },
  },
  "max-width": {
    ty: "size.MaxSize",
    logical_group: { ty: "max_size", category: "physical" },
  },
  "max-height": {
    ty: "size.MaxSize",
    logical_group: { ty: "max_size", category: "physical" },
  },
  "block-size": {
    ty: "size.Size",
    logical_group: { ty: "size", category: "logical" },
  },
  "inline-size": {
    ty: "size.Size",
    logical_group: { ty: "size", category: "logical" },
  },
  "min-block-size": {
    ty: "size.Size",
    logical_group: { ty: "min_size", category: "logical" },
  },
  "min-inline-size": {
    ty: "size.Size",
    logical_group: { ty: "min_size", category: "logical" },
  },
  "max-block-size": {
    ty: "size.MaxSize",
    logical_group: { ty: "max_size", category: "logical" },
  },
  "max-inline-size": {
    ty: "size.MaxSize",
    logical_group: { ty: "max_size", category: "logical" },
  },
  "box-sizing": {
    ty: "size.BoxSizing",
    valid_prefixes: ["webkit", "moz"],
  },
  "aspect-ratio": {
    ty: "size.AspectRatio",
  },
  overflow: {
    ty: "overflow.Overflow",
    shorthand: true,
  },
  "overflow-x": {
    ty: "overflow.OverflowKeyword",
  },
  "overflow-y": {
    ty: "overflow.OverflowKeyword",
  },
  "text-overflow": {
    ty: "overflow.TextOverflow",
    valid_prefixes: ["o"],
  },
  position: {
    ty: "position.Position",
  },
  top: {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "physical" },
  },
  bottom: {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "physical" },
  },
  left: {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "physical" },
  },
  right: {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "physical" },
  },
  "inset-block-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "logical" },
  },
  "inset-block-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "logical" },
  },
  "inset-inline-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "logical" },
  },
  "inset-inline-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "inset", category: "logical" },
  },
  "inset-block": {
    ty: "margin_padding.InsetBlock",
    shorthand: true,
  },
  "inset-inline": {
    ty: "margin_padding.InsetInline",
    shorthand: true,
  },
  inset: {
    ty: "margin_padding.Inset",
    shorthand: true,
  },
  "border-spacing": {
    ty: "css.css_values.size.Size2D(Length)",
  },
  "border-top-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "physical" },
  },
  "border-bottom-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "physical" },
  },
  "border-left-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "physical" },
  },
  "border-right-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "physical" },
  },
  "border-block-start-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "logical" },
  },
  "border-block-end-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "logical" },
  },
  "border-inline-start-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "logical" },
  },
  "border-inline-end-color": {
    ty: "CssColor",
    logical_group: { ty: "border_color", category: "logical" },
  },
  "border-top-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "physical" },
  },
  "border-bottom-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "physical" },
  },
  "border-left-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "physical" },
  },
  "border-right-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "physical" },
  },
  "border-block-start-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "logical" },
  },
  "border-block-end-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "logical" },
  },
  "border-inline-start-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "logical" },
  },
  "border-inline-end-style": {
    ty: "border.LineStyle",
    logical_group: { ty: "border_style", category: "logical" },
  },
  "border-top-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "physical" },
  },
  "border-bottom-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "physical" },
  },
  "border-left-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "physical" },
  },
  "border-right-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "physical" },
  },
  "border-block-start-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "logical" },
  },
  "border-block-end-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "logical" },
  },
  "border-inline-start-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "logical" },
  },
  "border-inline-end-width": {
    ty: "BorderSideWidth",
    logical_group: { ty: "border_width", category: "logical" },
  },
  "border-top-left-radius": {
    ty: "Size2D(LengthPercentage)",
    valid_prefixes: ["webkit", "moz"],
    logical_group: { ty: "border_radius", category: "physical" },
  },
  "border-top-right-radius": {
    ty: "Size2D(LengthPercentage)",
    valid_prefixes: ["webkit", "moz"],
    logical_group: { ty: "border_radius", category: "physical" },
  },
  "border-bottom-left-radius": {
    ty: "Size2D(LengthPercentage)",
    valid_prefixes: ["webkit", "moz"],
    logical_group: { ty: "border_radius", category: "physical" },
  },
  "border-bottom-right-radius": {
    ty: "Size2D(LengthPercentage)",
    valid_prefixes: ["webkit", "moz"],
    logical_group: { ty: "border_radius", category: "physical" },
  },
  "border-start-start-radius": {
    ty: "Size2D(LengthPercentage)",
    logical_group: { ty: "border_radius", category: "logical" },
  },
  "border-start-end-radius": {
    ty: "Size2D(LengthPercentage)",
    logical_group: { ty: "border_radius", category: "logical" },
  },
  "border-end-start-radius": {
    ty: "Size2D(LengthPercentage)",
    logical_group: { ty: "border_radius", category: "logical" },
  },
  "border-end-end-radius": {
    ty: "Size2D(LengthPercentage)",
    logical_group: { ty: "border_radius", category: "logical" },
  },
  "border-radius": {
    ty: "BorderRadius",
    valid_prefixes: ["webkit", "moz"],
    shorthand: true,
  },
  "border-image-source": {
    ty: "Image",
  },
  "border-image-outset": {
    ty: "Rect(LengthOrNumber)",
  },
  "border-image-repeat": {
    ty: "BorderImageRepeat",
  },
  "border-image-width": {
    ty: "Rect(BorderImageSideWidth)",
  },
  "border-image-slice": {
    ty: "BorderImageSlice",
  },
  "border-image": {
    ty: "BorderImage",
    valid_prefixes: ["webkit", "moz", "o"],
    shorthand: true,
  },
  "border-color": {
    ty: "BorderColor",
    shorthand: true,
  },
  "border-style": {
    ty: "BorderStyle",
    shorthand: true,
  },
  "border-width": {
    ty: "BorderWidth",
    shorthand: true,
  },
  "border-block-color": {
    ty: "BorderBlockColor",
    shorthand: true,
  },
  "border-block-style": {
    ty: "BorderBlockStyle",
    shorthand: true,
  },
  "border-block-width": {
    ty: "BorderBlockWidth",
    shorthand: true,
  },
  "border-inline-color": {
    ty: "BorderInlineColor",
    shorthand: true,
  },
  "border-inline-style": {
    ty: "BorderInlineStyle",
    shorthand: true,
  },
  "border-inline-width": {
    ty: "BorderInlineWidth",
    shorthand: true,
  },
  border: {
    ty: "Border",
    shorthand: true,
  },
  "border-top": {
    ty: "BorderTop",
    shorthand: true,
  },
  "border-bottom": {
    ty: "BorderBottom",
    shorthand: true,
  },
  "border-left": {
    ty: "BorderLeft",
    shorthand: true,
  },
  "border-right": {
    ty: "BorderRight",
    shorthand: true,
  },
  "border-block": {
    ty: "BorderBlock",
    shorthand: true,
  },
  "border-block-start": {
    ty: "BorderBlockStart",
    shorthand: true,
  },
  "border-block-end": {
    ty: "BorderBlockEnd",
    shorthand: true,
  },
  "border-inline": {
    ty: "BorderInline",
    shorthand: true,
  },
  "border-inline-start": {
    ty: "BorderInlineStart",
    shorthand: true,
  },
  "border-inline-end": {
    ty: "BorderInlineEnd",
    shorthand: true,
  },
  outline: {
    ty: "Outline",
    shorthand: true,
  },
  "outline-color": {
    ty: "CssColor",
  },
  "outline-style": {
    ty: "OutlineStyle",
  },
  "outline-width": {
    ty: "BorderSideWidth",
  },
  "flex-direction": {
    ty: "FlexDirection",
    valid_prefixes: ["webkit", "ms"],
  },
  "flex-wrap": {
    ty: "FlexWrap",
    valid_prefixes: ["webkit", "ms"],
  },
  "flex-flow": {
    ty: "FlexFlow",
    valid_prefixes: ["webkit", "ms"],
    shorthand: true,
  },
  "flex-grow": {
    ty: "CSSNumber",
    valid_prefixes: ["webkit"],
  },
  "flex-shrink": {
    ty: "CSSNumber",
    valid_prefixes: ["webkit"],
  },
  "flex-basis": {
    ty: "LengthPercentageOrAuto",
    valid_prefixes: ["webkit"],
  },
  flex: {
    ty: "Flex",
    valid_prefixes: ["webkit", "ms"],
    shorthand: true,
  },
  order: {
    ty: "CSSInteger",
    valid_prefixes: ["webkit"],
  },
  "align-content": {
    ty: "AlignContent",
    valid_prefixes: ["webkit"],
  },
  "justify-content": {
    ty: "JustifyContent",
    valid_prefixes: ["webkit"],
  },
  "place-content": {
    ty: "PlaceContent",
    shorthand: true,
  },
  "align-self": {
    ty: "AlignSelf",
    valid_prefixes: ["webkit"],
  },
  "justify-self": {
    ty: "JustifySelf",
  },
  "place-self": {
    ty: "PlaceSelf",
    shorthand: true,
  },
  "align-items": {
    ty: "AlignItems",
    valid_prefixes: ["webkit"],
  },
  "justify-items": {
    ty: "JustifyItems",
  },
  "place-items": {
    ty: "PlaceItems",
    shorthand: true,
  },
  "row-gap": {
    ty: "GapValue",
  },
  "column-gap": {
    ty: "GapValue",
  },
  gap: {
    ty: "Gap",
    shorthand: true,
  },
  "box-orient": {
    ty: "BoxOrient",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-direction": {
    ty: "BoxDirection",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-ordinal-group": {
    ty: "CSSInteger",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-align": {
    ty: "BoxAlign",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-flex": {
    ty: "CSSNumber",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-flex-group": {
    ty: "CSSInteger",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "box-pack": {
    ty: "BoxPack",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "box-lines": {
    ty: "BoxLines",
    valid_prefixes: ["webkit", "moz"],
    unprefixed: false,
  },
  "flex-pack": {
    ty: "FlexPack",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-order": {
    ty: "CSSInteger",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-align": {
    ty: "BoxAlign",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-item-align": {
    ty: "FlexItemAlign",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-line-pack": {
    ty: "FlexLinePack",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-positive": {
    ty: "CSSNumber",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-negative": {
    ty: "CSSNumber",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "flex-preferred-size": {
    ty: "LengthPercentageOrAuto",
    valid_prefixes: ["ms"],
    unprefixed: false,
  },
  "margin-top": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "physical" },
  },
  "margin-bottom": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "physical" },
  },
  "margin-left": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "physical" },
  },
  "margin-right": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "physical" },
    eval_branch_quota: 5000,
  },
  "margin-block-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "logical" },
    eval_branch_quota: 5000,
  },
  "margin-block-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "logical" },
  },
  "margin-inline-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "logical" },
  },
  "margin-inline-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "margin", category: "logical" },
  },
  "margin-block": {
    ty: "MarginBlock",
    shorthand: true,
  },
  "margin-inline": {
    ty: "MarginInline",
    shorthand: true,
  },
  margin: {
    ty: "Margin",
    shorthand: true,
    eval_branch_quota: 5000,
  },
  "padding-top": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "physical" },
  },
  "padding-bottom": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "physical" },
  },
  "padding-left": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "physical" },
  },
  "padding-right": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "physical" },
  },
  "padding-block-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "logical" },
  },
  "padding-block-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "logical" },
  },
  "padding-inline-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "logical" },
  },
  "padding-inline-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "padding", category: "logical" },
  },
  "padding-block": {
    ty: "PaddingBlock",
    shorthand: true,
  },
  "padding-inline": {
    ty: "PaddingInline",
    shorthand: true,
  },
  padding: {
    ty: "Padding",
    shorthand: true,
  },
  "scroll-margin-top": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "physical" },
  },
  "scroll-margin-bottom": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "physical" },
  },
  "scroll-margin-left": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "physical" },
  },
  "scroll-margin-right": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "physical" },
  },
  "scroll-margin-block-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "logical" },
  },
  "scroll-margin-block-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "logical" },
  },
  "scroll-margin-inline-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "logical" },
  },
  "scroll-margin-inline-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_margin", category: "logical" },
  },
  "scroll-margin-block": {
    ty: "ScrollMarginBlock",
    shorthand: true,
  },
  "scroll-margin-inline": {
    ty: "ScrollMarginInline",
    shorthand: true,
  },
  "scroll-margin": {
    ty: "ScrollMargin",
    shorthand: true,
  },
  "scroll-padding-top": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "physical" },
  },
  "scroll-padding-bottom": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "physical" },
  },
  "scroll-padding-left": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "physical" },
  },
  "scroll-padding-right": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "physical" },
  },
  "scroll-padding-block-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "logical" },
  },
  "scroll-padding-block-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "logical" },
  },
  "scroll-padding-inline-start": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "logical" },
  },
  "scroll-padding-inline-end": {
    ty: "LengthPercentageOrAuto",
    logical_group: { ty: "scroll_padding", category: "logical" },
  },
  "scroll-padding-block": {
    ty: "ScrollPaddingBlock",
    shorthand: true,
  },
  "scroll-padding-inline": {
    ty: "ScrollPaddingInline",
    shorthand: true,
  },
  "scroll-padding": {
    ty: "ScrollPadding",
    shorthand: true,
  },
  "font-weight": {
    ty: "FontWeight",
  },
  "font-size": {
    ty: "FontSize",
  },
  "font-stretch": {
    ty: "FontStretch",
  },
  "font-family": {
    ty: "BabyList(FontFamily)",
  },
  "font-style": {
    ty: "FontStyle",
  },
  "font-variant-caps": {
    ty: "FontVariantCaps",
  },
  "line-height": {
    ty: "LineHeight",
  },
  font: {
    ty: "Font",
    shorthand: true,
  },
  // "vertical-align": {
  //   ty: "VerticalAlign",
  // },
  // "font-palette": {
  //   ty: "DashedIdentReference",
  // },
  "transition-property": {
    ty: "SmallList(PropertyId, 1)",
    valid_prefixes: ["webkit", "moz", "ms"],
  },
  "transition-duration": {
    ty: "SmallList(Time, 1)",
    valid_prefixes: ["webkit", "moz", "ms"],
  },
  "transition-delay": {
    ty: "SmallList(Time, 1)",
    valid_prefixes: ["webkit", "moz", "ms"],
  },
  "transition-timing-function": {
    ty: "SmallList(EasingFunction, 1)",
    valid_prefixes: ["webkit", "moz", "ms"],
  },
  transition: {
    ty: "SmallList(Transition, 1)",
    valid_prefixes: ["webkit", "moz", "ms"],
    shorthand: true,
  },
  // "animation-name": {
  //   ty: "AnimationNameList",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-duration": {
  //   ty: "SmallList(Time, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-timing-function": {
  //   ty: "SmallList(EasingFunction, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-iteration-count": {
  //   ty: "SmallList(AnimationIterationCount, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-direction": {
  //   ty: "SmallList(AnimationDirection, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-play-state": {
  //   ty: "SmallList(AnimationPlayState, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-delay": {
  //   ty: "SmallList(Time, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-fill-mode": {
  //   ty: "SmallList(AnimationFillMode, 1)",
  //   valid_prefixes: ["webkit", "moz", "o"],
  // },
  // "animation-composition": {
  //   ty: "SmallList(AnimationComposition, 1)",
  // },
  // "animation-timeline": {
  //   ty: "SmallList(AnimationTimeline, 1)",
  // },
  // "animation-range-start": {
  //   ty: "SmallList(AnimationRangeStart, 1)",
  // },
  // "animation-range-end": {
  //   ty: "SmallList(AnimationRangeEnd, 1)",
  // },
  // "animation-range": {
  //   ty: "SmallList(AnimationRange, 1)",
  // },
  // animation: {
  //   ty: "AnimationList",
  //   valid_prefixes: ["webkit", "moz", "o"],
  //   shorthand: true,
  // },
  transform: {
    ty: "TransformList",
    valid_prefixes: ["webkit", "moz", "ms", "o"],
  },
  "transform-origin": {
    ty: "Position",
    valid_prefixes: ["webkit", "moz", "ms", "o"],
  },
  "transform-style": {
    ty: "TransformStyle",
    valid_prefixes: ["webkit", "moz"],
  },
  "transform-box": {
    ty: "TransformBox",
  },
  "backface-visibility": {
    ty: "BackfaceVisibility",
    valid_prefixes: ["webkit", "moz"],
  },
  perspective: {
    ty: "Perspective",
    valid_prefixes: ["webkit", "moz"],
  },
  "perspective-origin": {
    ty: "Position",
    valid_prefixes: ["webkit", "moz"],
  },
  translate: {
    ty: "Translate",
  },
  rotate: {
    ty: "Rotate",
  },
  scale: {
    ty: "Scale",
  },
  // "text-transform": {
  //   ty: "TextTransform",
  // },
  // "white-space": {
  //   ty: "WhiteSpace",
  // },
  // "tab-size": {
  //   ty: "LengthOrNumber",
  //   valid_prefixes: ["moz", "o"],
  // },
  // "word-break": {
  //   ty: "WordBreak",
  // },
  // "line-break": {
  //   ty: "LineBreak",
  // },
  // hyphens: {
  //   ty: "Hyphens",
  //   valid_prefixes: ["webkit", "moz", "ms"],
  // },
  // "overflow-wrap": {
  //   ty: "OverflowWrap",
  // },
  // "word-wrap": {
  //   ty: "OverflowWrap",
  // },
  // "text-align": {
  //   ty: "TextAlign",
  // },
  // "text-align-last": {
  //   ty: "TextAlignLast",
  //   valid_prefixes: ["moz"],
  // },
  // "text-justify": {
  //   ty: "TextJustify",
  // },
  // "word-spacing": {
  //   ty: "Spacing",
  // },
  // "letter-spacing": {
  //   ty: "Spacing",
  // },
  // "text-indent": {
  //   ty: "TextIndent",
  // },
  // "text-decoration-line": {
  //   ty: "TextDecorationLine",
  //   valid_prefixes: ["webkit", "moz"],
  // },
  // "text-decoration-style": {
  //   ty: "TextDecorationStyle",
  //   valid_prefixes: ["webkit", "moz"],
  // },
  "text-decoration-color": {
    ty: "CssColor",
    valid_prefixes: ["webkit", "moz"],
  },
  // "text-decoration-thickness": {
  //   ty: "TextDecorationThickness",
  // },
  // "text-decoration": {
  //   ty: "TextDecoration",
  //   valid_prefixes: ["webkit", "moz"],
  //   shorthand: true,
  // },
  // "text-decoration-skip-ink": {
  //   ty: "TextDecorationSkipInk",
  //   valid_prefixes: ["webkit"],
  // },
  // "text-emphasis-style": {
  //   ty: "TextEmphasisStyle",
  //   valid_prefixes: ["webkit"],
  // },
  "text-emphasis-color": {
    ty: "CssColor",
    valid_prefixes: ["webkit"],
  },
  // "text-emphasis": {
  //   ty: "TextEmphasis",
  //   valid_prefixes: ["webkit"],
  //   shorthand: true,
  // },
  // "text-emphasis-position": {
  //   ty: "TextEmphasisPosition",
  //   valid_prefixes: ["webkit"],
  // },
  "text-shadow": {
    ty: "SmallList(TextShadow, 1)",
  },
  // "text-size-adjust": {
  //   ty: "TextSizeAdjust",
  //   valid_prefixes: ["webkit", "moz", "ms"],
  // },
  direction: {
    ty: "Direction",
  },
  // "unicode-bidi": {
  //   ty: "UnicodeBidi",
  // },
  // "box-decoration-break": {
  //   ty: "BoxDecorationBreak",
  //   valid_prefixes: ["webkit"],
  // },
  // resize: {
  //   ty: "Resize",
  // },
  // cursor: {
  //   ty: "Cursor",
  // },
  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // "caret-color": {
  //   ty: "ColorOrAuto",
  // },
  // "caret-shape": {
  //   ty: "CaretShape",
  // },
  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // caret: {
  //   ty: "Caret",
  //   shorthand: true,
  // },
  // "user-select": {
  //   ty: "UserSelect",
  //   valid_prefixes: ["webkit", "moz", "ms"],
  // },
  // "accent-color": {
  //   ty: "ColorOrAuto",
  // },
  // appearance: {
  //   ty: "Appearance",
  //   valid_prefixes: ["webkit", "moz", "ms"],
  // },
  // "list-style-type": {
  //   ty: "ListStyleType",
  // },
  // "list-style-image": {
  //   ty: "Image",
  // },
  // "list-style-position": {
  //   ty: "ListStylePosition",
  // },
  // "list-style": {
  //   ty: "ListStyle",
  //   shorthand: true,
  // },
  // "marker-side": {
  //   ty: "MarkerSide",
  // },
  composes: {
    ty: "Composes",
    conditional: { css_modules: true },
    parse_dont_make_unparsed: true,
  },
  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // fill: {
  //   ty: "SVGPaint",
  // },
  // "fill-rule": {
  //   ty: "FillRule",
  // },
  // "fill-opacity": {
  //   ty: "AlphaValue",
  // },
  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // stroke: {
  //   ty: "SVGPaint",
  // },
  // "stroke-opacity": {
  //   ty: "AlphaValue",
  // },
  // "stroke-width": {
  //   ty: "LengthPercentage",
  // },
  // "stroke-linecap": {
  //   ty: "StrokeLinecap",
  // },
  // "stroke-linejoin": {
  //   ty: "StrokeLinejoin",
  // },
  // "stroke-miterlimit": {
  //   ty: "CSSNumber",
  // },
  // "stroke-dasharray": {
  //   ty: "StrokeDasharray",
  // },
  // "stroke-dashoffset": {
  //   ty: "LengthPercentage",
  // },
  // "marker-start": {
  //   ty: "Marker",
  // },
  // "marker-mid": {
  //   ty: "Marker",
  // },
  // "marker-end": {
  //   ty: "Marker",
  // },
  // marker: {
  //   ty: "Marker",
  // },
  // "color-interpolation": {
  //   ty: "ColorInterpolation",
  // },
  // "color-interpolation-filters": {
  //   ty: "ColorInterpolation",
  // },
  // "color-rendering": {
  //   ty: "ColorRendering",
  // },
  // "shape-rendering": {
  //   ty: "ShapeRendering",
  // },
  // "text-rendering": {
  //   ty: "TextRendering",
  // },
  // "image-rendering": {
  //   ty: "ImageRendering",
  // },
  // "clip-path": {
  //   ty: "ClipPath",
  //   valid_prefixes: ["webkit"],
  // },
  // "clip-rule": {
  //   ty: "FillRule",
  // },
  "mask-image": {
    ty: "SmallList(Image, 1)",
    valid_prefixes: ["webkit"],
  },
  "mask-mode": {
    ty: "SmallList(MaskMode, 1)",
  },
  "mask-repeat": {
    ty: "SmallList(BackgroundRepeat, 1)",
    valid_prefixes: ["webkit"],
  },
  "mask-position-x": {
    ty: "SmallList(HorizontalPosition, 1)",
  },
  "mask-position-y": {
    ty: "SmallList(VerticalPosition, 1)",
  },
  "mask-position": {
    ty: "SmallList(Position, 1)",
    valid_prefixes: ["webkit"],
  },
  "mask-clip": {
    ty: "SmallList(MaskClip, 1)",
    valid_prefixes: ["webkit"],
    eval_branch_quota: 5000,
  },
  "mask-origin": {
    ty: "SmallList(GeometryBox, 1)",
    valid_prefixes: ["webkit"],
  },
  "mask-size": {
    ty: "SmallList(BackgroundSize, 1)",
    valid_prefixes: ["webkit"],
  },
  "mask-composite": {
    ty: "SmallList(MaskComposite, 1)",
  },
  "mask-type": {
    ty: "MaskType",
  },
  mask: {
    ty: "SmallList(Mask, 1)",
    valid_prefixes: ["webkit"],
    shorthand: true,
  },
  "mask-border-source": {
    ty: "Image",
  },
  "mask-border-mode": {
    ty: "MaskBorderMode",
  },
  "mask-border-slice": {
    ty: "BorderImageSlice",
  },
  "mask-border-width": {
    ty: "Rect(BorderImageSideWidth)",
  },
  "mask-border-outset": {
    ty: "Rect(LengthOrNumber)",
  },
  "mask-border-repeat": {
    ty: "BorderImageRepeat",
  },
  "mask-border": {
    ty: "MaskBorder",
    shorthand: true,
  },
  // WebKit additions
  "-webkit-mask-composite": {
    ty: "SmallList(WebKitMaskComposite, 1)",
  },
  "mask-source-type": {
    ty: "SmallList(WebKitMaskSourceType, 1)",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image": {
    ty: "BorderImage",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image-source": {
    ty: "Image",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image-slice": {
    ty: "BorderImageSlice",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image-width": {
    ty: "Rect(BorderImageSideWidth)",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image-outset": {
    ty: "Rect(LengthOrNumber)",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },
  "mask-box-image-repeat": {
    ty: "BorderImageRepeat",
    valid_prefixes: ["webkit"],
    unprefixed: false,
  },

  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // filter: {
  //   ty: "FilterList",
  //   valid_prefixes: ["webkit"],
  // },
  // TODO: Hello future Zack, if you uncomment this, remember to uncomment the corresponding value in FallbackHandler in prefix_handler.zig :)
  // "backdrop-filter": {
  //   ty: "FilterList",
  //   valid_prefixes: ["webkit"],
  // },
  // "z-index": {
  //   ty: "position.ZIndex",
  // },
  // "container-type": {
  //   ty: "ContainerType",
  // },
  // "container-name": {
  //   ty: "ContainerNameList",
  // },
  // container: {
  //   ty: "Container",
  //   shorthand: true,
  // },
  // "view-transition-name": {
  //   ty: "CustomIdent",
  // },
  "color-scheme": {
    ty: "ColorScheme",
  },
});

function prelude() {
  return /* zig */ `const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const Printer = css.Printer;
const PrintErr = css.PrintErr;
const VendorPrefix = css.VendorPrefix;

const properties_impl = @import("./properties_impl.zig");

const CSSWideKeyword = css.css_properties.CSSWideKeyword;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;
const CustomProperty = css.css_properties.custom.CustomProperty;
const Targets = css.targets.Targets;
const Feature = css.prefixes.Feature;

const ColorScheme = css.css_properties.ui.ColorScheme;

const TransformList = css.css_properties.transform.TransformList;
const TransformStyle = css.css_properties.transform.TransformStyle;
const TransformBox = css.css_properties.transform.TransformBox;
const BackfaceVisibility = css.css_properties.transform.BackfaceVisibility;
const Perspective = css.css_properties.transform.Perspective;
const Translate = css.css_properties.transform.Translate;
const Rotate = css.css_properties.transform.Rotate;
const Scale = css.css_properties.transform.Scale;

const css_values = css.css_values;
const CssColor = css.css_values.color.CssColor;
const Image = css.css_values.image.Image;
const Length = css.css_values.length.Length;
const LengthValue = css.css_values.length.LengthValue;
const LengthPercentage = css_values.length.LengthPercentage;
const LengthPercentageOrAuto = css_values.length.LengthPercentageOrAuto;
const PropertyCategory = css.PropertyCategory;
const LogicalGroup = css.LogicalGroup;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const CSSInteger = css.css_values.number.CSSInteger;
const CSSIntegerFns = css.css_values.number.CSSIntegerFns;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Percentage = css.css_values.percentage.Percentage;
const Angle = css.css_values.angle.Angle;
const DashedIdentReference = css.css_values.ident.DashedIdentReference;
const Time = css.css_values.time.Time;
const EasingFunction = css.css_values.easing.EasingFunction;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const DashedIdent = css.css_values.ident.DashedIdent;
const Url = css.css_values.url.Url;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Location = css.Location;
const HorizontalPosition = css.css_values.position.HorizontalPosition;
const VerticalPosition = css.css_values.position.VerticalPosition;
const ContainerName = css.css_rules.container.ContainerName;

pub const font = css.css_properties.font;
const border = css.css_properties.border;
const border_radius = css.css_properties.border_radius;
const border_image = css.css_properties.border_image;
const outline = css.css_properties.outline;
const flex = css.css_properties.flex;
const @"align" = css.css_properties.@"align";
const margin_padding = css.css_properties.margin_padding;
const transition = css.css_properties.transition;
const animation = css.css_properties.animation;
const transform = css.css_properties.transform;
const text = css.css_properties.text;
const ui = css.css_properties.ui;
const list = css.css_properties.list;
const css_modules = css.css_properties.css_modules;
const svg = css.css_properties.svg;
const shape = css.css_properties.shape;
const masking = css.css_properties.masking;
const background = css.css_properties.background;
const effects = css.css_properties.effects;
const contain = css.css_properties.contain;
const custom = css.css_properties.custom;
const position = css.css_properties.position;
const box_shadow = css.css_properties.box_shadow;
const size = css.css_properties.size;
const overflow = css.css_properties.overflow;

const BorderSideWidth = border.BorderSideWidth;
const Size2D = css_values.size.Size2D;
const BorderRadius = border_radius.BorderRadius;
const Rect = css_values.rect.Rect;
const LengthOrNumber = css_values.length.LengthOrNumber;
const BorderImageRepeat = border_image.BorderImageRepeat;
const BorderImageSideWidth = border_image.BorderImageSideWidth;
const BorderImageSlice = border_image.BorderImageSlice;
const BorderImage = border_image.BorderImage;
const BorderColor = border.BorderColor;
const BorderStyle = border.BorderStyle;
const BorderWidth = border.BorderWidth;
const BorderBlockColor = border.BorderBlockColor;
const BorderBlockStyle = border.BorderBlockStyle;
const BorderBlockWidth = border.BorderBlockWidth;
const BorderInlineColor = border.BorderInlineColor;
const BorderInlineStyle = border.BorderInlineStyle;
const BorderInlineWidth = border.BorderInlineWidth;
const Border = border.Border;
const BorderTop = border.BorderTop;
const BorderRight = border.BorderRight;
const BorderLeft = border.BorderLeft;
const BorderBottom = border.BorderBottom;
const BorderBlockStart = border.BorderBlockStart;
const BorderBlockEnd = border.BorderBlockEnd;
const BorderInlineStart = border.BorderInlineStart;
const BorderInlineEnd = border.BorderInlineEnd;
const BorderBlock = border.BorderBlock;
const BorderInline = border.BorderInline;
const Outline = outline.Outline;
const OutlineStyle = outline.OutlineStyle;
const FlexDirection = flex.FlexDirection;
const FlexWrap = flex.FlexWrap;
const FlexFlow = flex.FlexFlow;
const Flex = flex.Flex;
const BoxOrient = flex.BoxOrient;
const BoxDirection = flex.BoxDirection;
const BoxAlign = flex.BoxAlign;
const BoxPack = flex.BoxPack;
const BoxLines = flex.BoxLines;
const FlexPack = flex.FlexPack;
const FlexItemAlign = flex.FlexItemAlign;
const FlexLinePack = flex.FlexLinePack;
const AlignContent = @"align".AlignContent;
const JustifyContent = @"align".JustifyContent;
const PlaceContent = @"align".PlaceContent;
const AlignSelf = @"align".AlignSelf;
const JustifySelf = @"align".JustifySelf;
const PlaceSelf = @"align".PlaceSelf;
const AlignItems = @"align".AlignItems;
const JustifyItems = @"align".JustifyItems;
const PlaceItems = @"align".PlaceItems;
const GapValue = @"align".GapValue;
const Gap = @"align".Gap;
const MarginBlock = margin_padding.MarginBlock;
const Margin = margin_padding.Margin;
const MarginInline = margin_padding.MarginInline;
const PaddingBlock = margin_padding.PaddingBlock;
const PaddingInline = margin_padding.PaddingInline;
const Padding = margin_padding.Padding;
const ScrollMarginBlock = margin_padding.ScrollMarginBlock;
const ScrollMarginInline = margin_padding.ScrollMarginInline;
const ScrollMargin = margin_padding.ScrollMargin;
const ScrollPaddingBlock = margin_padding.ScrollPaddingBlock;
const ScrollPaddingInline = margin_padding.ScrollPaddingInline;
const ScrollPadding = margin_padding.ScrollPadding;
const FontWeight = font.FontWeight;
const FontSize = font.FontSize;
const FontStretch = font.FontStretch;
const FontFamily = font.FontFamily;
const FontStyle = font.FontStyle;
const FontVariantCaps = font.FontVariantCaps;
const LineHeight = font.LineHeight;
const Font = font.Font;
// const VerticalAlign = font.VerticalAlign;
const Transition = transition.Transition;
// const AnimationNameList = animation.AnimationNameList;
// const AnimationList = animation.AnimationList;
// const AnimationIterationCount = animation.AnimationIterationCount;
// const AnimationDirection = animation.AnimationDirection;
// const AnimationPlayState = animation.AnimationPlayState;
// const AnimationFillMode = animation.AnimationFillMode;
// const AnimationComposition = animation.AnimationComposition;
// const AnimationTimeline = animation.AnimationTimeline;
// const AnimationRangeStart = animation.AnimationRangeStart;
// const AnimationRangeEnd = animation.AnimationRangeEnd;
// const AnimationRange = animation.AnimationRange;
// const TransformList = transform.TransformList;
// const TransformStyle = transform.TransformStyle;
// const TransformBox = transform.TransformBox;
// const BackfaceVisibility = transform.BackfaceVisibility;
// const Perspective = transform.Perspective;
// const Translate = transform.Translate;
// const Rotate = transform.Rotate;
// const Scale = transform.Scale;
// const TextTransform = text.TextTransform;
// const WhiteSpace = text.WhiteSpace;
// const WordBreak = text.WordBreak;
// const LineBreak = text.LineBreak;
// const Hyphens = text.Hyphens;
// const OverflowWrap = text.OverflowWrap;
// const TextAlign = text.TextAlign;
// const TextIndent = text.TextIndent;
// const Spacing = text.Spacing;
// const TextJustify = text.TextJustify;
// const TextAlignLast = text.TextAlignLast;
// const TextDecorationLine = text.TextDecorationLine;
// const TextDecorationStyle = text.TextDecorationStyle;
// const TextDecorationThickness = text.TextDecorationThickness;
// const TextDecoration = text.TextDecoration;
// const TextDecorationSkipInk = text.TextDecorationSkipInk;
// const TextEmphasisStyle = text.TextEmphasisStyle;
// const TextEmphasis = text.TextEmphasis;
// const TextEmphasisPositionVertical = text.TextEmphasisPositionVertical;
// const TextEmphasisPositionHorizontal = text.TextEmphasisPositionHorizontal;
// const TextEmphasisPosition = text.TextEmphasisPosition;
const TextShadow = text.TextShadow;
// const TextSizeAdjust = text.TextSizeAdjust;
const Direction = text.Direction;
// const UnicodeBidi = text.UnicodeBidi;
// const BoxDecorationBreak = text.BoxDecorationBreak;
// const Resize = ui.Resize;
// const Cursor = ui.Cursor;
// const ColorOrAuto = ui.ColorOrAuto;
// const CaretShape = ui.CaretShape;
// const Caret = ui.Caret;
// const UserSelect = ui.UserSelect;
// const Appearance = ui.Appearance;
// const ColorScheme = ui.ColorScheme;
// const ListStyleType = list.ListStyleType;
// const ListStylePosition = list.ListStylePosition;
// const ListStyle = list.ListStyle;
// const MarkerSide = list.MarkerSide;
const Composes = css_modules.Composes;
// const SVGPaint = svg.SVGPaint;
// const FillRule = shape.FillRule;
// const AlphaValue = shape.AlphaValue;
// const StrokeLinecap = svg.StrokeLinecap;
// const StrokeLinejoin = svg.StrokeLinejoin;
// const StrokeDasharray = svg.StrokeDasharray;
// const Marker = svg.Marker;
// const ColorInterpolation = svg.ColorInterpolation;
// const ColorRendering = svg.ColorRendering;
// const ShapeRendering = svg.ShapeRendering;
// const TextRendering = svg.TextRendering;
// const ImageRendering = svg.ImageRendering;
const ClipPath = masking.ClipPath;
const MaskMode = masking.MaskMode;
const MaskClip = masking.MaskClip;
const GeometryBox = masking.GeometryBox;
const MaskComposite = masking.MaskComposite;
const MaskType = masking.MaskType;
const Mask = masking.Mask;
const MaskBorderMode = masking.MaskBorderMode;
const MaskBorder = masking.MaskBorder;
const WebKitMaskComposite = masking.WebKitMaskComposite;
const WebKitMaskSourceType = masking.WebKitMaskSourceType;
const BackgroundRepeat = background.BackgroundRepeat;
const BackgroundSize = background.BackgroundSize;
// const FilterList = effects.FilterList;
// const ContainerType = contain.ContainerType;
// const Container = contain.Container;
// const ContainerNameList = contain.ContainerNameList;
const CustomPropertyName = custom.CustomPropertyName;
const display = css.css_properties.display;

const Position = position.Position;

const Result = css.Result;

const BabyList = bun.BabyList;
const ArrayList = std.ArrayListUnmanaged;
const SmallList = css.SmallList;

`;
}

function featureName(name: string): string {
  return name.replaceAll("-", "_");
}
