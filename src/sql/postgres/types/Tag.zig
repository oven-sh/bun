//     select b.typname,  b.oid, b.typarray
//       from pg_catalog.pg_type a
//       left join pg_catalog.pg_type b on b.oid = a.typelem
//       where a.typcategory = 'A'
//       group by b.oid, b.typarray
//       order by b.oid
// ;
//                 typname                |  oid  | typarray
// ---------------------------------------+-------+----------
//  bool                                  |    16 |     1000
//  bytea                                 |    17 |     1001
//  char                                  |    18 |     1002
//  name                                  |    19 |     1003
//  int8                                  |    20 |     1016
//  int2                                  |    21 |     1005
//  int2vector                            |    22 |     1006
//  int4                                  |    23 |     1007
//  regproc                               |    24 |     1008
//  text                                  |    25 |     1009
//  oid                                   |    26 |     1028
//  tid                                   |    27 |     1010
//  xid                                   |    28 |     1011
//  cid                                   |    29 |     1012
//  oidvector                             |    30 |     1013
//  pg_type                               |    71 |      210
//  pg_attribute                          |    75 |      270
//  pg_proc                               |    81 |      272
//  pg_class                              |    83 |      273
//  json                                  |   114 |      199
//  xml                                   |   142 |      143
//  point                                 |   600 |     1017
//  lseg                                  |   601 |     1018
//  path                                  |   602 |     1019
//  box                                   |   603 |     1020
//  polygon                               |   604 |     1027
//  line                                  |   628 |      629
//  cidr                                  |   650 |      651
//  float4                                |   700 |     1021
//  float8                                |   701 |     1022
//  circle                                |   718 |      719
//  macaddr8                              |   774 |      775
//  money                                 |   790 |      791
//  macaddr                               |   829 |     1040
//  inet                                  |   869 |     1041
//  aclitem                               |  1033 |     1034
//  bpchar                                |  1042 |     1014
//  varchar                               |  1043 |     1015
//  date                                  |  1082 |     1182
//  time                                  |  1083 |     1183
//  timestamp                             |  1114 |     1115
//  timestamptz                           |  1184 |     1185
//  interval                              |  1186 |     1187
//  pg_database                           |  1248 |    12052
//  timetz                                |  1266 |     1270
//  bit                                   |  1560 |     1561
//  varbit                                |  1562 |     1563
//  numeric                               |  1700 |     1231
pub const Tag = enum(short) {
    bool = 16,
    bytea = 17,
    char = 18,
    name = 19,
    int8 = 20,
    int2 = 21,
    int2vector = 22,
    int4 = 23,
    // regproc = 24,
    text = 25,
    oid = 26,
    // tid = 27,
    xid = 28,
    cid = 29,
    // oidvector = 30,
    // pg_type = 71,
    // pg_attribute = 75,
    // pg_proc = 81,
    // pg_class = 83,
    json = 114,
    xml = 142,
    point = 600,
    lseg = 601,
    path = 602,
    box = 603,
    polygon = 604,
    line = 628,
    cidr = 650,
    float4 = 700,
    float8 = 701,
    circle = 718,
    macaddr8 = 774,
    money = 790,
    macaddr = 829,
    inet = 869,
    aclitem = 1033,
    bpchar = 1042,
    varchar = 1043,
    date = 1082,
    time = 1083,
    timestamp = 1114,
    timestamptz = 1184,
    interval = 1186,
    pg_database = 1248,
    timetz = 1266,
    bit = 1560,
    varbit = 1562,
    numeric = 1700,
    uuid = 2950,

    bool_array = 1000,
    bytea_array = 1001,
    char_array = 1002,
    name_array = 1003,
    int8_array = 1016,
    int2_array = 1005,
    int2vector_array = 1006,
    int4_array = 1007,
    // regproc_array = 1008,
    text_array = 1009,
    oid_array = 1028,
    tid_array = 1010,
    xid_array = 1011,
    cid_array = 1012,
    // oidvector_array = 1013,
    // pg_type_array = 210,
    // pg_attribute_array = 270,
    // pg_proc_array = 272,
    // pg_class_array = 273,
    json_array = 199,
    xml_array = 143,
    point_array = 1017,
    lseg_array = 1018,
    path_array = 1019,
    box_array = 1020,
    polygon_array = 1027,
    line_array = 629,
    cidr_array = 651,
    float4_array = 1021,
    float8_array = 1022,
    circle_array = 719,
    macaddr8_array = 775,
    money_array = 791,
    macaddr_array = 1040,
    inet_array = 1041,
    aclitem_array = 1034,
    bpchar_array = 1014,
    varchar_array = 1015,
    date_array = 1182,
    time_array = 1183,
    timestamp_array = 1115,
    timestamptz_array = 1185,
    interval_array = 1187,
    pg_database_array = 12052,
    timetz_array = 1270,
    bit_array = 1561,
    varbit_array = 1563,
    numeric_array = 1231,
    jsonb = 3802,
    jsonb_array = 3807,
    // Not really sure what this is.
    jsonpath = 4072,
    jsonpath_array = 4073,
    // another oid for pg_database
    pg_database_array2 = 10052,
    _,

    pub fn tagName(this: Tag) ?[]const u8 {
        return std.enums.tagName(Tag, this);
    }

    pub fn isBinaryFormatSupported(this: Tag) bool {
        return switch (this) {
            // TODO: .int2_array, .float8_array,
            .bool, .timestamp, .timestamptz, .time, .int4_array, .float4_array, .int4, .float8, .float4, .bytea, .numeric => true,

            else => false,
        };
    }

    pub fn formatCode(this: Tag) short {
        if (this.isBinaryFormatSupported()) {
            return 1;
        }

        return 0;
    }

    fn PostgresBinarySingleDimensionArray(comptime T: type) type {
        return extern struct {
            // struct array_int4 {
            //   int4_t ndim; /* Number of dimensions */
            //   int4_t _ign; /* offset for data, removed by libpq */
            //   Oid elemtype; /* type of element in the array */

            //   /* First dimension */
            //   int4_t size; /* Number of elements */
            //   int4_t index; /* Index of first element */
            //   int4_t first_value; /* Beginning of integer data */
            // };

            ndim: i32,
            offset_for_data: i32,
            element_type: i32,

            len: i32,
            index: i32,
            first_value: T,

            pub fn slice(this: *@This()) []T {
                if (this.len == 0) return &.{};

                var head = @as([*]T, @ptrCast(&this.first_value));
                var current = head;
                const len: usize = @intCast(this.len);
                for (0..len) |i| {
                    // Skip every other value as it contains the size of the element
                    current = current[1..];

                    const val = current[0];
                    const Int = std.meta.Int(.unsigned, @bitSizeOf(T));
                    const swapped = @byteSwap(@as(Int, @bitCast(val)));

                    head[i] = @bitCast(swapped);

                    current = current[1..];
                }

                return head[0..len];
            }

            pub fn init(bytes: []const u8) *@This() {
                const this: *@This() = @ptrCast(@alignCast(@constCast(bytes.ptr)));
                this.ndim = @byteSwap(this.ndim);
                this.offset_for_data = @byteSwap(this.offset_for_data);
                this.element_type = @byteSwap(this.element_type);
                this.len = @byteSwap(this.len);
                this.index = @byteSwap(this.index);
                return this;
            }
        };
    }

    pub fn toJSTypedArrayType(comptime T: Tag) !JSValue.JSType {
        return comptime switch (T) {
            .int4_array => .Int32Array,
            // .int2_array => .Uint2Array,
            .float4_array => .Float32Array,
            // .float8_array => .Float64Array,
            else => error.UnsupportedArrayType,
        };
    }

    pub fn byteArrayType(comptime T: Tag) !type {
        return comptime switch (T) {
            .int4_array => i32,
            // .int2_array => i16,
            .float4_array => f32,
            // .float8_array => f64,
            else => error.UnsupportedArrayType,
        };
    }

    pub fn pgArrayType(comptime T: Tag) !type {
        return PostgresBinarySingleDimensionArray(try byteArrayType(T));
    }

    fn toJSWithType(
        tag: Tag,
        globalObject: *jsc.JSGlobalObject,
        comptime Type: type,
        value: Type,
    ) AnyPostgresError!JSValue {
        switch (tag) {
            .numeric => {
                return JSValue.jsNumber(value);
            },

            .float4, .float8 => {
                return JSValue.jsNumber(value);
            },

            .json, .jsonb => {
                return json.toJS(globalObject, value);
            },

            .bool => {
                return @"bool".toJS(globalObject, value);
            },

            .timestamp, .timestamptz => {
                return date.toJS(globalObject, value);
            },

            .bytea => {
                return bytea.toJS(globalObject, value);
            },

            .int8 => {
                return JSValue.fromInt64NoTruncate(globalObject, value);
            },

            .int4 => {
                return JSValue.jsNumber(value);
            },

            else => {
                return string.toJS(globalObject, value);
            },
        }
    }

    pub fn toJS(
        tag: Tag,
        globalObject: *jsc.JSGlobalObject,
        value: anytype,
    ) AnyPostgresError!JSValue {
        return toJSWithType(tag, globalObject, @TypeOf(value), value);
    }

    pub fn fromJS(globalObject: *jsc.JSGlobalObject, value: JSValue) bun.JSError!Tag {
        if (value.isEmptyOrUndefinedOrNull()) {
            return Tag.numeric;
        }

        if (value.isCell()) {
            const tag = value.jsType();
            if (tag.isStringLike()) {
                return .text;
            }

            if (tag == .JSDate) {
                return .timestamptz;
            }

            if (tag.isTypedArrayOrArrayBuffer()) {
                if (tag == .Int32Array)
                    return .int4_array;

                return .bytea;
            }

            if (tag == .HeapBigInt) {
                return .int8;
            }

            if (tag.isArrayLike()) {
                // We will JSON.stringify anything else.
                return .json;
            }

            // Ban these types:
            if (tag == .NumberObject) {
                return globalObject.ERR(.INVALID_ARG_TYPE, "Number object is ambiguous and cannot be used as a PostgreSQL type", .{}).throw();
            }

            if (tag == .BooleanObject) {
                return globalObject.ERR(.INVALID_ARG_TYPE, "Boolean object is ambiguous and cannot be used as a PostgreSQL type", .{}).throw();
            }

            // It's something internal
            if (!tag.isIndexable()) {
                return globalObject.ERR(.INVALID_ARG_TYPE, "Unknown object is not a valid PostgreSQL type", .{}).throw();
            }

            // We will JSON.stringify anything else.
            if (tag.isObject()) {
                return .json;
            }
        }

        if (value.isInt32()) {
            return .int4;
        }

        if (value.isAnyInt()) {
            const int = value.toInt64();
            if (int >= std.math.minInt(i32) and int <= std.math.maxInt(i32)) {
                return .int4;
            }

            return .int8;
        }

        if (value.isNumber()) {
            return .float8;
        }

        if (value.isBoolean()) {
            return .bool;
        }

        return .numeric;
    }
};

const @"bool" = @import("./bool.zig");

const bun = @import("bun");
const bytea = @import("./bytea.zig");
const date = @import("./date.zig");
const json = @import("./json.zig");
const std = @import("std");
const string = @import("./PostgresString.zig");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const int_types = @import("./int_types.zig");
const short = int_types.short;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
