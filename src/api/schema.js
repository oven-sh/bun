const Loader = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "11": 11,
  "12": 12,
  "13": 13,
  "14": 14,
  "15": 15,
  "jsx": 1,
  "js": 2,
  "ts": 3,
  "tsx": 4,
  "css": 5,
  "file": 6,
  "json": 7,
  "toml": 8,
  "wasm": 9,
  "napi": 10,
  "base64": 11,
  "dataurl": 12,
  "text": 13,
  "sqlite": 14,
  "html": 15,
};
const LoaderKeys = {
  "1": "jsx",
  "2": "js",
  "3": "ts",
  "4": "tsx",
  "5": "css",
  "6": "file",
  "7": "json",
  "8": "toml",
  "9": "wasm",
  "10": "napi",
  "11": "base64",
  "12": "dataurl",
  "13": "text",
  "14": "sqlite",
  "15": "html",
  "jsx": "jsx",
  "js": "js",
  "ts": "ts",
  "tsx": "tsx",
  "css": "css",
  "file": "file",
  "json": "json",
  "toml": "toml",
  "wasm": "wasm",
  "napi": "napi",
  "base64": "base64",
  "dataurl": "dataurl",
  "text": "text",
  "sqlite": "sqlite",
  "html": "html",
};
const FrameworkEntryPointType = {
  "1": 1,
  "2": 2,
  "3": 3,
  "client": 1,
  "server": 2,
  "fallback": 3,
};
const FrameworkEntryPointTypeKeys = {
  "1": "client",
  "2": "server",
  "3": "fallback",
  "client": "client",
  "server": "server",
  "fallback": "fallback",
};
const StackFrameScope = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "Eval": 1,
  "Module": 2,
  "Function": 3,
  "Global": 4,
  "Wasm": 5,
  "Constructor": 6,
};
const StackFrameScopeKeys = {
  "1": "Eval",
  "2": "Module",
  "3": "Function",
  "4": "Global",
  "5": "Wasm",
  "6": "Constructor",
  "Eval": "Eval",
  "Module": "Module",
  "Function": "Function",
  "Global": "Global",
  "Wasm": "Wasm",
  "Constructor": "Constructor",
};

function decodeStackFrame(bb) {
  var result = {};

  result["function_name"] = bb.readString();
  result["file"] = bb.readString();
  result["position"] = decodeStackFramePosition(bb);
  result["scope"] = StackFrameScope[bb.readByte()];
  return result;
}

function encodeStackFrame(message, bb) {
  var value = message["function_name"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "function_name"');
  }

  var value = message["file"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "file"');
  }

  var value = message["position"];
  if (value != null) {
    encodeStackFramePosition(value, bb);
  } else {
    throw new Error('Missing required field "position"');
  }

  var value = message["scope"];
  if (value != null) {
    var encoded = StackFrameScope[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "StackFrameScope"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "scope"');
  }
}

function decodeStackFramePosition(bb) {
  var result = {};

  result["line"] = bb.readInt32();
  result["column"] = bb.readInt32();

  return result;
}

function encodeStackFramePosition(message, bb) {
  var value = message["source_offset"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "source_offset"');
  }

  var value = message["line"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "line"');
  }

  var value = message["line_start"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "line_start"');
  }

  var value = message["line_stop"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "line_stop"');
  }

  var value = message["column_start"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "column_start"');
  }

  var value = message["column_stop"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "column_stop"');
  }

  var value = message["expression_start"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "expression_start"');
  }

  var value = message["expression_stop"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "expression_stop"');
  }
}

function decodeSourceLine(bb) {
  var result = {};

  result["line"] = bb.readInt32();
  result["text"] = bb.readString();
  return result;
}

function encodeSourceLine(message, bb) {
  var value = message["line"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "line"');
  }

  var value = message["text"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "text"');
  }
}

function decodeStackTrace(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["source_lines"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeSourceLine(bb);
  var length = bb.readVarUint();
  var values = (result["frames"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeStackFrame(bb);
  return result;
}

function encodeStackTrace(message, bb) {
  var value = message["source_lines"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeSourceLine(value, bb);
    }
  } else {
    throw new Error('Missing required field "source_lines"');
  }

  var value = message["frames"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeStackFrame(value, bb);
    }
  } else {
    throw new Error('Missing required field "frames"');
  }
}

function decodeJSException(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["name"] = bb.readString();
        break;

      case 2:
        result["message"] = bb.readString();
        break;

      case 3:
        result["runtime_type"] = bb.readUint16();
        break;

      case 4:
        result["code"] = bb.readByte();
        break;

      case 5:
        result["stack"] = decodeStackTrace(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeJSException(message, bb) {
  var value = message["name"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["message"];
  if (value != null) {
    bb.writeByte(2);
    bb.writeString(value);
  }

  var value = message["runtime_type"];
  if (value != null) {
    bb.writeByte(3);
    bb.writeUint16(value);
  }

  var value = message["code"];
  if (value != null) {
    bb.writeByte(4);
    bb.writeByte(value);
  }

  var value = message["stack"];
  if (value != null) {
    bb.writeByte(5);
    encodeStackTrace(value, bb);
  }
  bb.writeByte(0);
}
const FallbackStep = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "ssr_disabled": 1,
  "create_vm": 2,
  "configure_router": 3,
  "configure_defines": 4,
  "resolve_entry_point": 5,
  "load_entry_point": 6,
  "eval_entry_point": 7,
  "fetch_event_handler": 8,
};
const FallbackStepKeys = {
  "1": "ssr_disabled",
  "2": "create_vm",
  "3": "configure_router",
  "4": "configure_defines",
  "5": "resolve_entry_point",
  "6": "load_entry_point",
  "7": "eval_entry_point",
  "8": "fetch_event_handler",
  "ssr_disabled": "ssr_disabled",
  "create_vm": "create_vm",
  "configure_router": "configure_router",
  "configure_defines": "configure_defines",
  "resolve_entry_point": "resolve_entry_point",
  "load_entry_point": "load_entry_point",
  "eval_entry_point": "eval_entry_point",
  "fetch_event_handler": "fetch_event_handler",
};

function decodeProblems(bb) {
  var result = {};

  result["code"] = bb.readUint16();
  result["name"] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["exceptions"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeJSException(bb);
  result["build"] = decodeLog(bb);
  return result;
}

function encodeProblems(message, bb) {
  var value = message["code"];
  if (value != null) {
    bb.writeUint16(value);
  } else {
    throw new Error('Missing required field "code"');
  }

  var value = message["name"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "name"');
  }

  var value = message["exceptions"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJSException(value, bb);
    }
  } else {
    throw new Error('Missing required field "exceptions"');
  }

  var value = message["build"];
  if (value != null) {
    encodeLog(value, bb);
  } else {
    throw new Error('Missing required field "build"');
  }
}

function decodeRouter(bb) {
  var result = {};

  result["routes"] = decodeStringMap(bb);
  result["route"] = bb.readInt32();
  result["params"] = decodeStringMap(bb);
  return result;
}

function encodeRouter(message, bb) {
  var value = message["routes"];
  if (value != null) {
    encodeStringMap(value, bb);
  } else {
    throw new Error('Missing required field "routes"');
  }

  var value = message["route"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "route"');
  }

  var value = message["params"];
  if (value != null) {
    encodeStringMap(value, bb);
  } else {
    throw new Error('Missing required field "params"');
  }
}

function decodeFallbackMessageContainer(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["message"] = bb.readString();
        break;

      case 2:
        result["router"] = decodeRouter(bb);
        break;

      case 3:
        result["reason"] = FallbackStep[bb.readByte()];
        break;

      case 4:
        result["problems"] = decodeProblems(bb);
        break;

      case 5:
        result["cwd"] = bb.readString();
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeFallbackMessageContainer(message, bb) {
  var value = message["message"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["router"];
  if (value != null) {
    bb.writeByte(2);
    encodeRouter(value, bb);
  }

  var value = message["reason"];
  if (value != null) {
    bb.writeByte(3);
    var encoded = FallbackStep[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "FallbackStep"');
    bb.writeByte(encoded);
  }

  var value = message["problems"];
  if (value != null) {
    bb.writeByte(4);
    encodeProblems(value, bb);
  }

  var value = message["cwd"];
  if (value != null) {
    bb.writeByte(5);
    bb.writeString(value);
  }
  bb.writeByte(0);
}
const ResolveMode = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "disable": 1,
  "lazy": 2,
  "dev": 3,
  "bundle": 4,
};
const ResolveModeKeys = {
  "1": "disable",
  "2": "lazy",
  "3": "dev",
  "4": "bundle",
  "disable": "disable",
  "lazy": "lazy",
  "dev": "dev",
  "bundle": "bundle",
};
const Target = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "browser": 1,
  "node": 2,
  "bun": 3,
  "bun_macro": 4,
};
const TargetKeys = {
  "1": "browser",
  "2": "node",
  "3": "bun",
  "4": "bun_macro",
  "browser": "browser",
  "node": "node",
  "bun": "bun",
  "bun_macro": "bun_macro",
};
const CSSInJSBehavior = {
  "1": 1,
  "2": 2,
  "3": 3,
  "facade": 1,
  "facade_onimportcss": 2,
  "auto_onimportcss": 3,
};
const CSSInJSBehaviorKeys = {
  "1": "facade",
  "2": "facade_onimportcss",
  "3": "auto_onimportcss",
  "facade": "facade",
  "facade_onimportcss": "facade_onimportcss",
  "auto_onimportcss": "auto_onimportcss",
};
const JSXRuntime = {
  "1": 1,
  "2": 2,
  "3": 3,
  "automatic": 1,
  "classic": 2,
  "solid": 3,
};
const JSXRuntimeKeys = {
  "1": "automatic",
  "2": "classic",
  "3": "solid",
  "automatic": "automatic",
  "classic": "classic",
  "solid": "solid",
};

function decodeJSX(bb) {
  var result = {};

  result["factory"] = bb.readString();
  result["runtime"] = JSXRuntime[bb.readByte()];
  result["fragment"] = bb.readString();
  result["development"] = !!bb.readByte();
  result["import_source"] = bb.readString();
  result["react_fast_refresh"] = !!bb.readByte();
  return result;
}

function encodeJSX(message, bb) {
  var value = message["factory"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "factory"');
  }

  var value = message["runtime"];
  if (value != null) {
    var encoded = JSXRuntime[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "JSXRuntime"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "runtime"');
  }

  var value = message["fragment"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "fragment"');
  }

  var value = message["development"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error('Missing required field "development"');
  }

  var value = message["import_source"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "import_source"');
  }

  var value = message["react_fast_refresh"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error('Missing required field "react_fast_refresh"');
  }
}

function decodeStringPointer(bb) {
  var result = {};

  result["offset"] = bb.readUint32();
  result["length"] = bb.readUint32();
  return result;
}

function encodeStringPointer(message, bb) {
  var value = message["offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "offset"');
  }

  var value = message["length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "length"');
  }
}

function decodeJavascriptBundledModule(bb) {
  var result = {};

  result["path"] = decodeStringPointer(bb);
  result["code"] = decodeStringPointer(bb);
  result["package_id"] = bb.readUint32();
  result["id"] = bb.readUint32();
  result["path_extname_length"] = bb.readByte();
  return result;
}

function encodeJavascriptBundledModule(message, bb) {
  var value = message["path"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["code"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "code"');
  }

  var value = message["package_id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "package_id"');
  }

  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }

  var value = message["path_extname_length"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error('Missing required field "path_extname_length"');
  }
}

function decodeJavascriptBundledPackage(bb) {
  var result = {};

  result["name"] = decodeStringPointer(bb);
  result["version"] = decodeStringPointer(bb);
  result["hash"] = bb.readUint32();
  result["modules_offset"] = bb.readUint32();
  result["modules_length"] = bb.readUint32();
  return result;
}

function encodeJavascriptBundledPackage(message, bb) {
  var value = message["name"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "name"');
  }

  var value = message["version"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "version"');
  }

  var value = message["hash"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "hash"');
  }

  var value = message["modules_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "modules_offset"');
  }

  var value = message["modules_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "modules_length"');
  }
}

function decodeJavascriptBundle(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["modules"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeJavascriptBundledModule(bb);
  var length = bb.readVarUint();
  var values = (result["packages"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeJavascriptBundledPackage(bb);
  result["etag"] = bb.readByteArray();
  result["generated_at"] = bb.readUint32();
  result["app_package_json_dependencies_hash"] = bb.readByteArray();
  result["import_from_name"] = bb.readByteArray();
  result["manifest_string"] = bb.readByteArray();
  return result;
}

function encodeJavascriptBundle(message, bb) {
  var value = message["modules"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJavascriptBundledModule(value, bb);
    }
  } else {
    throw new Error('Missing required field "modules"');
  }

  var value = message["packages"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJavascriptBundledPackage(value, bb);
    }
  } else {
    throw new Error('Missing required field "packages"');
  }

  var value = message["etag"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "etag"');
  }

  var value = message["generated_at"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "generated_at"');
  }

  var value = message["app_package_json_dependencies_hash"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "app_package_json_dependencies_hash"');
  }

  var value = message["import_from_name"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "import_from_name"');
  }

  var value = message["manifest_string"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "manifest_string"');
  }
}

function decodeJavascriptBundleContainer(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["bundle_format_version"] = bb.readUint32();
        break;

      case 3:
        result["routes"] = decodeLoadedRouteConfig(bb);
        break;

      case 2:
        result["framework"] = decodeLoadedFramework(bb);
        break;

      case 4:
        result["bundle"] = decodeJavascriptBundle(bb);
        break;

      case 5:
        result["code_length"] = bb.readUint32();
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeJavascriptBundleContainer(message, bb) {
  var value = message["bundle_format_version"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeUint32(value);
  }

  var value = message["routes"];
  if (value != null) {
    bb.writeByte(3);
    encodeLoadedRouteConfig(value, bb);
  }

  var value = message["framework"];
  if (value != null) {
    bb.writeByte(2);
    encodeLoadedFramework(value, bb);
  }

  var value = message["bundle"];
  if (value != null) {
    bb.writeByte(4);
    encodeJavascriptBundle(value, bb);
  }

  var value = message["code_length"];
  if (value != null) {
    bb.writeByte(5);
    bb.writeUint32(value);
  }
  bb.writeByte(0);
}
const ScanDependencyMode = {
  "1": 1,
  "2": 2,
  "app": 1,
  "all": 2,
};
const ScanDependencyModeKeys = {
  "1": "app",
  "2": "all",
  "app": "app",
  "all": "all",
};
const ModuleImportType = {
  "1": 1,
  "2": 2,
  "import": 1,
  "require": 2,
};
const ModuleImportTypeKeys = {
  "1": "import",
  "2": "require",
  "import": "import",
  "require": "require",
};

function decodeModuleImportRecord(bb) {
  var result = {};

  result["kind"] = ModuleImportType[bb.readByte()];
  result["path"] = bb.readString();
  result["dynamic"] = !!bb.readByte();
  return result;
}

function encodeModuleImportRecord(message, bb) {
  var value = message["kind"];
  if (value != null) {
    var encoded = ModuleImportType[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "ModuleImportType"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["dynamic"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error('Missing required field "dynamic"');
  }
}

function decodeModule(bb) {
  var result = {};

  result["path"] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["imports"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeModuleImportRecord(bb);
  return result;
}

function encodeModule(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["imports"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeModuleImportRecord(value, bb);
    }
  } else {
    throw new Error('Missing required field "imports"');
  }
}

function decodeStringMap(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["keys"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["values"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  return result;
}

function encodeStringMap(message, bb) {
  var value = message["keys"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "keys"');
  }

  var value = message["values"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "values"');
  }
}

function decodeLoaderMap(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["extensions"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["loaders"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = Loader[bb.readByte()];
  return result;
}

function encodeLoaderMap(message, bb) {
  var value = message["extensions"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "extensions"');
  }

  var value = message["loaders"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      var encoded = Loader[value];
      if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
      bb.writeByte(encoded);
    }
  } else {
    throw new Error('Missing required field "loaders"');
  }
}
const DotEnvBehavior = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "disable": 1,
  "prefix": 2,
  "load_all": 3,
  "load_all_without_inlining": 4,
};
const DotEnvBehaviorKeys = {
  "1": "disable",
  "2": "prefix",
  "3": "load_all",
  "4": "load_all_without_inlining",
  "disable": "disable",
  "prefix": "prefix",
  "load_all": "load_all",
  "load_all_without_inlining": "load_all_without_inlining",
};

function decodeEnvConfig(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["prefix"] = bb.readString();
        break;

      case 2:
        result["defaults"] = decodeStringMap(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeEnvConfig(message, bb) {
  var value = message["prefix"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["defaults"];
  if (value != null) {
    bb.writeByte(2);
    encodeStringMap(value, bb);
  }
  bb.writeByte(0);
}

function decodeLoadedEnvConfig(bb) {
  var result = {};

  result["dotenv"] = DotEnvBehavior[bb.readVarUint()];
  result["defaults"] = decodeStringMap(bb);
  result["prefix"] = bb.readString();
  return result;
}

function encodeLoadedEnvConfig(message, bb) {
  var value = message["dotenv"];
  if (value != null) {
    var encoded = DotEnvBehavior[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "DotEnvBehavior"');
    bb.writeVarUint(encoded);
  } else {
    throw new Error('Missing required field "dotenv"');
  }

  var value = message["defaults"];
  if (value != null) {
    encodeStringMap(value, bb);
  } else {
    throw new Error('Missing required field "defaults"');
  }

  var value = message["prefix"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "prefix"');
  }
}

function decodeFrameworkConfig(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["package"] = bb.readString();
        break;

      case 2:
        result["client"] = decodeFrameworkEntryPointMessage(bb);
        break;

      case 3:
        result["server"] = decodeFrameworkEntryPointMessage(bb);
        break;

      case 4:
        result["fallback"] = decodeFrameworkEntryPointMessage(bb);
        break;

      case 5:
        result["development"] = !!bb.readByte();
        break;

      case 6:
        result["client_css_in_js"] = CSSInJSBehavior[bb.readByte()];
        break;

      case 7:
        result["display_name"] = bb.readString();
        break;

      case 8:
        result["overrideModules"] = decodeStringMap(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeFrameworkConfig(message, bb) {
  var value = message["package"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["client"];
  if (value != null) {
    bb.writeByte(2);
    encodeFrameworkEntryPointMessage(value, bb);
  }

  var value = message["server"];
  if (value != null) {
    bb.writeByte(3);
    encodeFrameworkEntryPointMessage(value, bb);
  }

  var value = message["fallback"];
  if (value != null) {
    bb.writeByte(4);
    encodeFrameworkEntryPointMessage(value, bb);
  }

  var value = message["development"];
  if (value != null) {
    bb.writeByte(5);
    bb.writeByte(value);
  }

  var value = message["client_css_in_js"];
  if (value != null) {
    bb.writeByte(6);
    var encoded = CSSInJSBehavior[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "CSSInJSBehavior"');
    bb.writeByte(encoded);
  }

  var value = message["display_name"];
  if (value != null) {
    bb.writeByte(7);
    bb.writeString(value);
  }

  var value = message["overrideModules"];
  if (value != null) {
    bb.writeByte(8);
    encodeStringMap(value, bb);
  }
  bb.writeByte(0);
}

function decodeFrameworkEntryPoint(bb) {
  var result = {};

  result["kind"] = FrameworkEntryPointType[bb.readByte()];
  result["path"] = bb.readString();
  result["env"] = decodeLoadedEnvConfig(bb);
  return result;
}

function encodeFrameworkEntryPoint(message, bb) {
  var value = message["kind"];
  if (value != null) {
    var encoded = FrameworkEntryPointType[value];
    if (encoded === void 0)
      throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "FrameworkEntryPointType"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["env"];
  if (value != null) {
    encodeLoadedEnvConfig(value, bb);
  } else {
    throw new Error('Missing required field "env"');
  }
}

function decodeFrameworkEntryPointMap(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["client"] = decodeFrameworkEntryPoint(bb);
        break;

      case 2:
        result["server"] = decodeFrameworkEntryPoint(bb);
        break;

      case 3:
        result["fallback"] = decodeFrameworkEntryPoint(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeFrameworkEntryPointMap(message, bb) {
  var value = message["client"];
  if (value != null) {
    bb.writeByte(1);
    encodeFrameworkEntryPoint(value, bb);
  }

  var value = message["server"];
  if (value != null) {
    bb.writeByte(2);
    encodeFrameworkEntryPoint(value, bb);
  }

  var value = message["fallback"];
  if (value != null) {
    bb.writeByte(3);
    encodeFrameworkEntryPoint(value, bb);
  }
  bb.writeByte(0);
}

function decodeFrameworkEntryPointMessage(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["path"] = bb.readString();
        break;

      case 2:
        result["env"] = decodeEnvConfig(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeFrameworkEntryPointMessage(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["env"];
  if (value != null) {
    bb.writeByte(2);
    encodeEnvConfig(value, bb);
  }
  bb.writeByte(0);
}

function decodeLoadedFramework(bb) {
  var result = {};

  result["package"] = bb.readString();
  result["display_name"] = bb.readString();
  result["development"] = !!bb.readByte();
  result["entry_points"] = decodeFrameworkEntryPointMap(bb);
  result["client_css_in_js"] = CSSInJSBehavior[bb.readByte()];
  result["overrideModules"] = decodeStringMap(bb);
  return result;
}

function encodeLoadedFramework(message, bb) {
  var value = message["package"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "package"');
  }

  var value = message["display_name"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "display_name"');
  }

  var value = message["development"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error('Missing required field "development"');
  }

  var value = message["entry_points"];
  if (value != null) {
    encodeFrameworkEntryPointMap(value, bb);
  } else {
    throw new Error('Missing required field "entry_points"');
  }

  var value = message["client_css_in_js"];
  if (value != null) {
    var encoded = CSSInJSBehavior[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "CSSInJSBehavior"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "client_css_in_js"');
  }

  var value = message["overrideModules"];
  if (value != null) {
    encodeStringMap(value, bb);
  } else {
    throw new Error('Missing required field "overrideModules"');
  }
}

function decodeLoadedRouteConfig(bb) {
  var result = {};

  result["dir"] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["extensions"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  result["static_dir"] = bb.readString();
  result["asset_prefix"] = bb.readString();
  return result;
}

function encodeLoadedRouteConfig(message, bb) {
  var value = message["dir"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "dir"');
  }

  var value = message["extensions"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "extensions"');
  }

  var value = message["static_dir"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "static_dir"');
  }

  var value = message["asset_prefix"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "asset_prefix"');
  }
}

function decodeRouteConfig(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        var length = bb.readVarUint();
        var values = (result["dir"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 2:
        var length = bb.readVarUint();
        var values = (result["extensions"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 3:
        result["static_dir"] = bb.readString();
        break;

      case 4:
        result["asset_prefix"] = bb.readString();
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeRouteConfig(message, bb) {
  var value = message["dir"];
  if (value != null) {
    bb.writeByte(1);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["extensions"];
  if (value != null) {
    bb.writeByte(2);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["static_dir"];
  if (value != null) {
    bb.writeByte(3);
    bb.writeString(value);
  }

  var value = message["asset_prefix"];
  if (value != null) {
    bb.writeByte(4);
    bb.writeString(value);
  }
  bb.writeByte(0);
}

function decodeTransformOptions(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["jsx"] = decodeJSX(bb);
        break;

      case 2:
        result["tsconfig_override"] = bb.readString();
        break;

      case 3:
        result["resolve"] = ResolveMode[bb.readByte()];
        break;

      case 4:
        result["origin"] = bb.readString();
        break;

      case 5:
        result["absolute_working_dir"] = bb.readString();
        break;

      case 6:
        result["define"] = decodeStringMap(bb);
        break;

      case 7:
        result["preserve_symlinks"] = !!bb.readByte();
        break;

      case 8:
        var length = bb.readVarUint();
        var values = (result["entry_points"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 9:
        result["write"] = !!bb.readByte();
        break;

      case 10:
        var length = bb.readVarUint();
        var values = (result["inject"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 11:
        result["output_dir"] = bb.readString();
        break;

      case 12:
        var length = bb.readVarUint();
        var values = (result["external"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 13:
        result["loaders"] = decodeLoaderMap(bb);
        break;

      case 14:
        var length = bb.readVarUint();
        var values = (result["main_fields"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 15:
        result["target"] = Target[bb.readByte()];
        break;

      case 16:
        result["serve"] = !!bb.readByte();
        break;

      case 17:
        var length = bb.readVarUint();
        var values = (result["env_files"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 18:
        var length = bb.readVarUint();
        var values = (result["extension_order"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 19:
        result["framework"] = decodeFrameworkConfig(bb);
        break;

      case 20:
        result["router"] = decodeRouteConfig(bb);
        break;

      case 21:
        result["no_summary"] = !!bb.readByte();
        break;

      case 22:
        result["disable_hmr"] = !!bb.readByte();
        break;

      case 23:
        result["port"] = bb.readUint16();
        break;

      case 24:
        result["logLevel"] = MessageLevel[bb.readVarUint()];
        break;

      case 25:
        result["source_map"] = SourceMapMode[bb.readByte()];
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeTransformOptions(message, bb) {
  var value = message["jsx"];
  if (value != null) {
    bb.writeByte(1);
    encodeJSX(value, bb);
  }

  var value = message["tsconfig_override"];
  if (value != null) {
    bb.writeByte(2);
    bb.writeString(value);
  }

  var value = message["resolve"];
  if (value != null) {
    bb.writeByte(3);
    var encoded = ResolveMode[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "ResolveMode"');
    bb.writeByte(encoded);
  }

  var value = message["origin"];
  if (value != null) {
    bb.writeByte(4);
    bb.writeString(value);
  }

  var value = message["absolute_working_dir"];
  if (value != null) {
    bb.writeByte(5);
    bb.writeString(value);
  }

  var value = message["define"];
  if (value != null) {
    bb.writeByte(6);
    encodeStringMap(value, bb);
  }

  var value = message["preserve_symlinks"];
  if (value != null) {
    bb.writeByte(7);
    bb.writeByte(value);
  }

  var value = message["entry_points"];
  if (value != null) {
    bb.writeByte(8);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["write"];
  if (value != null) {
    bb.writeByte(9);
    bb.writeByte(value);
  }

  var value = message["inject"];
  if (value != null) {
    bb.writeByte(10);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["output_dir"];
  if (value != null) {
    bb.writeByte(11);
    bb.writeString(value);
  }

  var value = message["external"];
  if (value != null) {
    bb.writeByte(12);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["loaders"];
  if (value != null) {
    bb.writeByte(13);
    encodeLoaderMap(value, bb);
  }

  var value = message["main_fields"];
  if (value != null) {
    bb.writeByte(14);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["target"];
  if (value != null) {
    bb.writeByte(15);
    var encoded = Target[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Target"');
    bb.writeByte(encoded);
  }

  var value = message["serve"];
  if (value != null) {
    bb.writeByte(16);
    bb.writeByte(value);
  }

  var value = message["env_files"];
  if (value != null) {
    bb.writeByte(17);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["extension_order"];
  if (value != null) {
    bb.writeByte(18);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["framework"];
  if (value != null) {
    bb.writeByte(19);
    encodeFrameworkConfig(value, bb);
  }

  var value = message["router"];
  if (value != null) {
    bb.writeByte(20);
    encodeRouteConfig(value, bb);
  }

  var value = message["no_summary"];
  if (value != null) {
    bb.writeByte(21);
    bb.writeByte(value);
  }

  var value = message["disable_hmr"];
  if (value != null) {
    bb.writeByte(22);
    bb.writeByte(value);
  }

  var value = message["port"];
  if (value != null) {
    bb.writeByte(23);
    bb.writeUint16(value);
  }

  var value = message["logLevel"];
  if (value != null) {
    bb.writeByte(24);
    var encoded = MessageLevel[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "MessageLevel"');
    bb.writeVarUint(encoded);
  }

  var value = message["source_map"];
  if (value != null) {
    bb.writeByte(25);
    var encoded = SourceMapMode[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "SourceMapMode"');
    bb.writeByte(encoded);
  }
  bb.writeByte(0);
}
const SourceMapMode = {
  "1": 1,
  "2": 2,
  "inline_into_file": 1,
  "external": 2,
};
const SourceMapModeKeys = {
  "1": "inline_into_file",
  "2": "external",
  "inline_into_file": "inline_into_file",
  "external": "external",
};

function decodeFileHandle(bb) {
  var result = {};

  result["path"] = bb.readString();
  result["size"] = bb.readVarUint();
  result["fd"] = bb.readVarUint();
  return result;
}

function encodeFileHandle(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["size"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error('Missing required field "size"');
  }

  var value = message["fd"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error('Missing required field "fd"');
  }
}

function decodeTransform(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["handle"] = decodeFileHandle(bb);
        break;

      case 2:
        result["path"] = bb.readString();
        break;

      case 3:
        result["contents"] = bb.readByteArray();
        break;

      case 4:
        result["loader"] = Loader[bb.readByte()];
        break;

      case 5:
        result["options"] = decodeTransformOptions(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeTransform(message, bb) {
  var value = message["handle"];
  if (value != null) {
    bb.writeByte(1);
    encodeFileHandle(value, bb);
  }

  var value = message["path"];
  if (value != null) {
    bb.writeByte(2);
    bb.writeString(value);
  }

  var value = message["contents"];
  if (value != null) {
    bb.writeByte(3);
    bb.writeByteArray(value);
  }

  var value = message["loader"];
  if (value != null) {
    bb.writeByte(4);
    var encoded = Loader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
    bb.writeByte(encoded);
  }

  var value = message["options"];
  if (value != null) {
    bb.writeByte(5);
    encodeTransformOptions(value, bb);
  }
  bb.writeByte(0);
}

function decodeScan(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["path"] = bb.readString();
        break;

      case 2:
        result["contents"] = bb.readByteArray();
        break;

      case 3:
        result["loader"] = Loader[bb.readByte()];
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeScan(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["contents"];
  if (value != null) {
    bb.writeByte(2);
    bb.writeByteArray(value);
  }

  var value = message["loader"];
  if (value != null) {
    bb.writeByte(3);
    var encoded = Loader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
    bb.writeByte(encoded);
  }
  bb.writeByte(0);
}

function decodeScanResult(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["exports"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["imports"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeScannedImport(bb);
  var length = bb.readVarUint();
  var values = (result["errors"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeMessage(bb);
  return result;
}

function encodeScanResult(message, bb) {
  var value = message["exports"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "exports"');
  }

  var value = message["imports"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeScannedImport(value, bb);
    }
  } else {
    throw new Error('Missing required field "imports"');
  }

  var value = message["errors"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else {
    throw new Error('Missing required field "errors"');
  }
}

function decodeScannedImport(bb) {
  var result = {};

  result["path"] = bb.readString();
  result["kind"] = ImportKind[bb.readByte()];
  return result;
}

function encodeScannedImport(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["kind"];
  if (value != null) {
    var encoded = ImportKind[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "ImportKind"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }
}
const ImportKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "entry_point": 1,
  "stmt": 2,
  "require": 3,
  "dynamic": 4,
  "require_resolve": 5,
  "at": 6,
  "url": 7,
  "internal": 8,
};
const ImportKindKeys = {
  "1": "entry_point",
  "2": "stmt",
  "3": "require",
  "4": "dynamic",
  "5": "require_resolve",
  "6": "at",
  "7": "url",
  "8": "internal",
  "entry_point": "entry_point",
  "stmt": "stmt",
  "require": "require",
  "dynamic": "dynamic",
  "require_resolve": "require_resolve",
  "at": "at",
  "url": "url",
  "internal": "internal",
};
const TransformResponseStatus = {
  "1": 1,
  "2": 2,
  "success": 1,
  "fail": 2,
};
const TransformResponseStatusKeys = {
  "1": "success",
  "2": "fail",
  "success": "success",
  "fail": "fail",
};

function decodeOutputFile(bb) {
  var result = {};

  result["data"] = bb.readByteArray();
  result["path"] = bb.readString();
  return result;
}

function encodeOutputFile(message, bb) {
  var value = message["data"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "data"');
  }

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }
}

function decodeTransformResponse(bb) {
  var result = {};

  result["status"] = TransformResponseStatus[bb.readVarUint()];
  var length = bb.readVarUint();
  var values = (result["files"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeOutputFile(bb);
  var length = bb.readVarUint();
  var values = (result["errors"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeMessage(bb);
  return result;
}

function encodeTransformResponse(message, bb) {
  var value = message["status"];
  if (value != null) {
    var encoded = TransformResponseStatus[value];
    if (encoded === void 0)
      throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "TransformResponseStatus"');
    bb.writeVarUint(encoded);
  } else {
    throw new Error('Missing required field "status"');
  }

  var value = message["files"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeOutputFile(value, bb);
    }
  } else {
    throw new Error('Missing required field "files"');
  }

  var value = message["errors"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else {
    throw new Error('Missing required field "errors"');
  }
}
const MessageLevel = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "err": 1,
  "warn": 2,
  "note": 3,
  "info": 4,
  "debug": 5,
};
const MessageLevelKeys = {
  "1": "err",
  "2": "warn",
  "3": "note",
  "4": "info",
  "5": "debug",
  "err": "err",
  "warn": "warn",
  "note": "note",
  "info": "info",
  "debug": "debug",
};

function decodeLocation(bb) {
  var result = {};

  result["file"] = bb.readString();
  result["namespace"] = bb.readString();
  result["line"] = bb.readInt32();
  result["column"] = bb.readInt32();
  result["line_text"] = bb.readString();
  result["suggestion"] = bb.readString();
  result["offset"] = bb.readVarUint();
  return result;
}

function encodeLocation(message, bb) {
  var value = message["file"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "file"');
  }

  var value = message["namespace"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "namespace"');
  }

  var value = message["line"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "line"');
  }

  var value = message["column"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "column"');
  }

  var value = message["line_text"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "line_text"');
  }

  var value = message["suggestion"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "suggestion"');
  }

  var value = message["offset"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error('Missing required field "offset"');
  }
}

function decodeMessageData(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["text"] = bb.readString();
        break;

      case 2:
        result["location"] = decodeLocation(bb);
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeMessageData(message, bb) {
  var value = message["text"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["location"];
  if (value != null) {
    bb.writeByte(2);
    encodeLocation(value, bb);
  }
  bb.writeByte(0);
}

function decodeMessageMeta(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["resolve"] = bb.readString();
        break;

      case 2:
        result["build"] = !!bb.readByte();
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeMessageMeta(message, bb) {
  var value = message["resolve"];
  if (value != null) {
    bb.writeByte(1);
    bb.writeString(value);
  }

  var value = message["build"];
  if (value != null) {
    bb.writeByte(2);
    bb.writeByte(value);
  }
  bb.writeByte(0);
}

function decodeMessage(bb) {
  var result = {};

  result["level"] = MessageLevel[bb.readVarUint()];
  result["data"] = decodeMessageData(bb);
  var length = bb.readVarUint();
  var values = (result["notes"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeMessageData(bb);
  result["on"] = decodeMessageMeta(bb);
  return result;
}

function encodeMessage(message, bb) {
  var value = message["level"];
  if (value != null) {
    var encoded = MessageLevel[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "MessageLevel"');
    bb.writeVarUint(encoded);
  } else {
    throw new Error('Missing required field "level"');
  }

  var value = message["data"];
  if (value != null) {
    encodeMessageData(value, bb);
  } else {
    throw new Error('Missing required field "data"');
  }

  var value = message["notes"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessageData(value, bb);
    }
  } else {
    throw new Error('Missing required field "notes"');
  }

  var value = message["on"];
  if (value != null) {
    encodeMessageMeta(value, bb);
  } else {
    throw new Error('Missing required field "on"');
  }
}

function decodeLog(bb) {
  var result = {};

  result["warnings"] = bb.readUint32();
  result["errors"] = bb.readUint32();
  var length = bb.readVarUint();
  var values = (result["msgs"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeMessage(bb);
  return result;
}

function encodeLog(message, bb) {
  var value = message["warnings"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "warnings"');
  }

  var value = message["errors"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "errors"');
  }

  var value = message["msgs"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else {
    throw new Error('Missing required field "msgs"');
  }
}
const Reloader = {
  "1": 1,
  "2": 2,
  "3": 3,
  "disable": 1,
  "live": 2,
  "fast_refresh": 3,
};
const ReloaderKeys = {
  "1": "disable",
  "2": "live",
  "3": "fast_refresh",
  "disable": "disable",
  "live": "live",
  "fast_refresh": "fast_refresh",
};
const WebsocketMessageKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "welcome": 1,
  "file_change_notification": 2,
  "build_success": 3,
  "build_fail": 4,
  "manifest_success": 5,
  "manifest_fail": 6,
  "resolve_file": 7,
  "file_change_notification_with_hint": 8,
};
const WebsocketMessageKindKeys = {
  "1": "welcome",
  "2": "file_change_notification",
  "3": "build_success",
  "4": "build_fail",
  "5": "manifest_success",
  "6": "manifest_fail",
  "7": "resolve_file",
  "8": "file_change_notification_with_hint",
  "welcome": "welcome",
  "file_change_notification": "file_change_notification",
  "build_success": "build_success",
  "build_fail": "build_fail",
  "manifest_success": "manifest_success",
  "manifest_fail": "manifest_fail",
  "resolve_file": "resolve_file",
  "file_change_notification_with_hint": "file_change_notification_with_hint",
};
const WebsocketCommandKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "build": 1,
  "manifest": 2,
  "build_with_file_path": 3,
};
const WebsocketCommandKindKeys = {
  "1": "build",
  "2": "manifest",
  "3": "build_with_file_path",
  "build": "build",
  "manifest": "manifest",
  "build_with_file_path": "build_with_file_path",
};

function decodeWebsocketMessage(bb) {
  var result = {};

  result["timestamp"] = bb.readUint32();
  result["kind"] = WebsocketMessageKind[bb.readByte()];
  return result;
}

function encodeWebsocketMessage(message, bb) {
  var value = message["timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "timestamp"');
  }

  var value = message["kind"];
  if (value != null) {
    var encoded = WebsocketMessageKind[value];
    if (encoded === void 0)
      throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "WebsocketMessageKind"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }
}

function decodeWebsocketMessageWelcome(bb) {
  var result = {};

  result["epoch"] = bb.readUint32();
  result["javascriptReloader"] = Reloader[bb.readByte()];
  result["cwd"] = bb.readString();
  result["assetPrefix"] = bb.readString();
  return result;
}

function encodeWebsocketMessageWelcome(message, bb) {
  var value = message["epoch"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "epoch"');
  }

  var value = message["javascriptReloader"];
  if (value != null) {
    var encoded = Reloader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Reloader"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "javascriptReloader"');
  }

  var value = message["cwd"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "cwd"');
  }

  var value = message["assetPrefix"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "assetPrefix"');
  }
}

function decodeWebsocketMessageFileChangeNotification(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["loader"] = Loader[bb.readByte()];
  return result;
}

function encodeWebsocketMessageFileChangeNotification(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "loader"');
  }
}

function decodeWebsocketCommand(bb) {
  var result = {};

  result["kind"] = WebsocketCommandKind[bb.readByte()];
  result["timestamp"] = bb.readUint32();
  return result;
}

function encodeWebsocketCommand(message, bb) {
  var value = message["kind"];
  if (value != null) {
    var encoded = WebsocketCommandKind[value];
    if (encoded === void 0)
      throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "WebsocketCommandKind"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }

  var value = message["timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "timestamp"');
  }
}

function decodeWebsocketCommandBuild(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  return result;
}

function encodeWebsocketCommandBuild(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }
}

function decodeWebsocketCommandManifest(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  return result;
}

function encodeWebsocketCommandManifest(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }
}

function decodeWebsocketMessageBuildSuccess(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["from_timestamp"] = bb.readUint32();
  result["loader"] = Loader[bb.readByte()];
  result["module_path"] = bb.readString();
  result["blob_length"] = bb.readUint32();
  return result;
}

function encodeWebsocketMessageBuildSuccess(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }

  var value = message["from_timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "from_timestamp"');
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "loader"');
  }

  var value = message["module_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "module_path"');
  }

  var value = message["blob_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "blob_length"');
  }
}

function decodeWebsocketMessageBuildFailure(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["from_timestamp"] = bb.readUint32();
  result["loader"] = Loader[bb.readByte()];
  result["module_path"] = bb.readString();
  result["log"] = decodeLog(bb);
  return result;
}

function encodeWebsocketMessageBuildFailure(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }

  var value = message["from_timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "from_timestamp"');
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "Loader"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "loader"');
  }

  var value = message["module_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "module_path"');
  }

  var value = message["log"];
  if (value != null) {
    encodeLog(value, bb);
  } else {
    throw new Error('Missing required field "log"');
  }
}

function decodeWebsocketCommandBuildWithFilePath(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["file_path"] = bb.readString();
  return result;
}

function encodeWebsocketCommandBuildWithFilePath(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }

  var value = message["file_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "file_path"');
  }
}

function decodeWebsocketMessageResolveID(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  return result;
}

function encodeWebsocketMessageResolveID(message, bb) {
  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "id"');
  }
}

function decodeNPMRegistry(bb) {
  var result = {};

  result["url"] = bb.readString();
  result["username"] = bb.readString();
  result["password"] = bb.readString();
  result["token"] = bb.readString();
  return result;
}

function encodeNPMRegistry(message, bb) {
  var value = message["url"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "url"');
  }

  var value = message["username"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "username"');
  }

  var value = message["password"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "password"');
  }

  var value = message["token"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "token"');
  }
}

function decodeNPMRegistryMap(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["scopes"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = (result["registries"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeNPMRegistry(bb);
  return result;
}

function encodeNPMRegistryMap(message, bb) {
  var value = message["scopes"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error('Missing required field "scopes"');
  }

  var value = message["registries"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeNPMRegistry(value, bb);
    }
  } else {
    throw new Error('Missing required field "registries"');
  }
}

function decodeBunInstall(bb) {
  var result = {};

  while (true) {
    switch (bb.readByte()) {
      case 0:
        return result;

      case 1:
        result["default_registry"] = decodeNPMRegistry(bb);
        break;

      case 2:
        result["scoped"] = decodeNPMRegistryMap(bb);
        break;

      case 3:
        result["lockfile_path"] = bb.readString();
        break;

      case 4:
        result["save_lockfile_path"] = bb.readString();
        break;

      case 5:
        result["cache_directory"] = bb.readString();
        break;

      case 6:
        result["dry_run"] = !!bb.readByte();
        break;

      case 7:
        result["force"] = !!bb.readByte();
        break;

      case 8:
        result["save_dev"] = !!bb.readByte();
        break;

      case 9:
        result["save_optional"] = !!bb.readByte();
        break;

      case 10:
        result["save_peer"] = !!bb.readByte();
        break;

      case 11:
        result["save_lockfile"] = !!bb.readByte();
        break;

      case 12:
        result["production"] = !!bb.readByte();
        break;

      case 13:
        result["save_yarn_lockfile"] = !!bb.readByte();
        break;

      case 14:
        var length = bb.readVarUint();
        var values = (result["native_bin_links"] = Array(length));
        for (var i = 0; i < length; i++) values[i] = bb.readString();
        break;

      case 15:
        result["disable_cache"] = !!bb.readByte();
        break;

      case 16:
        result["disable_manifest_cache"] = !!bb.readByte();
        break;

      case 17:
        result["global_dir"] = bb.readString();
        break;

      case 18:
        result["global_bin_dir"] = bb.readString();
        break;

      case 19:
        result["frozen_lockfile"] = !!bb.readByte();
        break;

      case 20:
        result["exact"] = !!bb.readByte();
        break;

      case 21:
        result["concurrent_scripts"] = bb.readUint32();
        break;

      default:
        throw new Error("Attempted to parse invalid message");
    }
  }
}

function encodeBunInstall(message, bb) {
  var value = message["default_registry"];
  if (value != null) {
    bb.writeByte(1);
    encodeNPMRegistry(value, bb);
  }

  var value = message["scoped"];
  if (value != null) {
    bb.writeByte(2);
    encodeNPMRegistryMap(value, bb);
  }

  var value = message["lockfile_path"];
  if (value != null) {
    bb.writeByte(3);
    bb.writeString(value);
  }

  var value = message["save_lockfile_path"];
  if (value != null) {
    bb.writeByte(4);
    bb.writeString(value);
  }

  var value = message["cache_directory"];
  if (value != null) {
    bb.writeByte(5);
    bb.writeString(value);
  }

  var value = message["dry_run"];
  if (value != null) {
    bb.writeByte(6);
    bb.writeByte(value);
  }

  var value = message["force"];
  if (value != null) {
    bb.writeByte(7);
    bb.writeByte(value);
  }

  var value = message["save_dev"];
  if (value != null) {
    bb.writeByte(8);
    bb.writeByte(value);
  }

  var value = message["save_optional"];
  if (value != null) {
    bb.writeByte(9);
    bb.writeByte(value);
  }

  var value = message["save_peer"];
  if (value != null) {
    bb.writeByte(10);
    bb.writeByte(value);
  }

  var value = message["save_lockfile"];
  if (value != null) {
    bb.writeByte(11);
    bb.writeByte(value);
  }

  var value = message["production"];
  if (value != null) {
    bb.writeByte(12);
    bb.writeByte(value);
  }

  var value = message["save_yarn_lockfile"];
  if (value != null) {
    bb.writeByte(13);
    bb.writeByte(value);
  }

  var value = message["native_bin_links"];
  if (value != null) {
    bb.writeByte(14);
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["disable_cache"];
  if (value != null) {
    bb.writeByte(15);
    bb.writeByte(value);
  }

  var value = message["disable_manifest_cache"];
  if (value != null) {
    bb.writeByte(16);
    bb.writeByte(value);
  }

  var value = message["global_dir"];
  if (value != null) {
    bb.writeByte(17);
    bb.writeString(value);
  }

  var value = message["global_bin_dir"];
  if (value != null) {
    bb.writeByte(18);
    bb.writeString(value);
  }

  var value = message["frozen_lockfile"];
  if (value != null) {
    bb.writeByte(19);
    bb.writeByte(value);
  }

  var value = message["exact"];
  if (value != null) {
    bb.writeByte(20);
    bb.writeByte(value);
  }

  var value = message["concurrent_scripts"];
  if (value != null) {
    bb.writeByte(21);
    bb.writeUint32(value);
  }
  bb.writeByte(0);
}

function decodeClientServerModule(bb) {
  var result = {};

  result["moduleId"] = bb.readUint32();
  result["inputName"] = decodeStringPointer(bb);
  result["assetName"] = decodeStringPointer(bb);
  result["exportNames"] = decodeStringPointer(bb);
  return result;
}

function encodeClientServerModule(message, bb) {
  var value = message["moduleId"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "moduleId"');
  }

  var value = message["inputName"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "inputName"');
  }

  var value = message["assetName"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "assetName"');
  }

  var value = message["exportNames"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "exportNames"');
  }
}

function decodeClientServerModuleManifest(bb) {
  var result = {};

  result["version"] = bb.readUint32();
  var length = bb.readVarUint();
  var values = (result["clientModules"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeClientServerModule(bb);
  var length = bb.readVarUint();
  var values = (result["serverModules"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeClientServerModule(bb);
  var length = bb.readVarUint();
  var values = (result["ssrModules"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeClientServerModule(bb);
  var length = bb.readVarUint();
  var values = (result["exportNames"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeStringPointer(bb);
  result["contents"] = bb.readByteArray();
  return result;
}

function encodeClientServerModuleManifest(message, bb) {
  var value = message["version"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "version"');
  }

  var value = message["clientModules"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeClientServerModule(value, bb);
    }
  } else {
    throw new Error('Missing required field "clientModules"');
  }

  var value = message["serverModules"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeClientServerModule(value, bb);
    }
  } else {
    throw new Error('Missing required field "serverModules"');
  }

  var value = message["ssrModules"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeClientServerModule(value, bb);
    }
  } else {
    throw new Error('Missing required field "ssrModules"');
  }

  var value = message["exportNames"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeStringPointer(value, bb);
    }
  } else {
    throw new Error('Missing required field "exportNames"');
  }

  var value = message["contents"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "contents"');
  }
}

function decodeGetTestsRequest(bb) {
  var result = {};

  result["path"] = bb.readString();
  result["contents"] = bb.readByteArray();
  return result;
}

function encodeGetTestsRequest(message, bb) {
  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error('Missing required field "path"');
  }

  var value = message["contents"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "contents"');
  }
}
const TestKind = {
  "1": 1,
  "2": 2,
  "test_fn": 1,
  "describe_fn": 2,
};
const TestKindKeys = {
  "1": "test_fn",
  "2": "describe_fn",
  "test_fn": "test_fn",
  "describe_fn": "describe_fn",
};

function decodeTestResponseItem(bb) {
  var result = {};

  result["byteOffset"] = bb.readInt32();
  result["label"] = decodeStringPointer(bb);
  result["kind"] = TestKind[bb.readByte()];
  return result;
}

function encodeTestResponseItem(message, bb) {
  var value = message["byteOffset"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error('Missing required field "byteOffset"');
  }

  var value = message["label"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "label"');
  }

  var value = message["kind"];
  if (value != null) {
    var encoded = TestKind[value];
    if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' for enum "TestKind"');
    bb.writeByte(encoded);
  } else {
    throw new Error('Missing required field "kind"');
  }
}

function decodeGetTestsResponse(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = (result["tests"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeTestResponseItem(bb);
  result["contents"] = bb.readByteArray();
  return result;
}

function encodeGetTestsResponse(message, bb) {
  var value = message["tests"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeTestResponseItem(value, bb);
    }
  } else {
    throw new Error('Missing required field "tests"');
  }

  var value = message["contents"];
  if (value != null) {
    bb.writeByteArray(value);
  } else {
    throw new Error('Missing required field "contents"');
  }
}

export {
  CSSInJSBehavior,
  CSSInJSBehaviorKeys,
  DotEnvBehavior,
  DotEnvBehaviorKeys,
  FallbackStep,
  FallbackStepKeys,
  FrameworkEntryPointType,
  FrameworkEntryPointTypeKeys,
  ImportKind,
  ImportKindKeys,
  JSXRuntime,
  JSXRuntimeKeys,
  Loader,
  LoaderKeys,
  MessageLevel,
  MessageLevelKeys,
  ModuleImportType,
  ModuleImportTypeKeys,
  Reloader,
  ReloaderKeys,
  ResolveMode,
  ResolveModeKeys,
  ScanDependencyMode,
  ScanDependencyModeKeys,
  SourceMapMode,
  SourceMapModeKeys,
  StackFrameScope,
  StackFrameScopeKeys,
  Target,
  TargetKeys,
  TestKind,
  TestKindKeys,
  TransformResponseStatus,
  TransformResponseStatusKeys,
  WebsocketCommandKind,
  WebsocketCommandKindKeys,
  WebsocketMessageKind,
  WebsocketMessageKindKeys,
  decodeBunInstall,
  decodeClientServerModule,
  decodeClientServerModuleManifest,
  decodeEnvConfig,
  decodeFallbackMessageContainer,
  decodeFileHandle,
  decodeFrameworkConfig,
  decodeFrameworkEntryPoint,
  decodeFrameworkEntryPointMap,
  decodeFrameworkEntryPointMessage,
  decodeGetTestsRequest,
  decodeGetTestsResponse,
  decodeJSException,
  decodeJSX,
  decodeJavascriptBundle,
  decodeJavascriptBundleContainer,
  decodeJavascriptBundledModule,
  decodeJavascriptBundledPackage,
  decodeLoadedEnvConfig,
  decodeLoadedFramework,
  decodeLoadedRouteConfig,
  decodeLoaderMap,
  decodeLocation,
  decodeLog,
  decodeMessage,
  decodeMessageData,
  decodeMessageMeta,
  decodeModule,
  decodeModuleImportRecord,
  decodeNPMRegistry,
  decodeNPMRegistryMap,
  decodeOutputFile,
  decodeProblems,
  decodeRouteConfig,
  decodeRouter,
  decodeScan,
  decodeScanResult,
  decodeScannedImport,
  decodeSourceLine,
  decodeStackFrame,
  decodeStackFramePosition,
  decodeStackTrace,
  decodeStringMap,
  decodeStringPointer,
  decodeTestResponseItem,
  decodeTransform,
  decodeTransformOptions,
  decodeTransformResponse,
  decodeWebsocketCommand,
  decodeWebsocketCommandBuild,
  decodeWebsocketCommandBuildWithFilePath,
  decodeWebsocketCommandManifest,
  decodeWebsocketMessage,
  decodeWebsocketMessageBuildFailure,
  decodeWebsocketMessageBuildSuccess,
  decodeWebsocketMessageFileChangeNotification,
  decodeWebsocketMessageResolveID,
  decodeWebsocketMessageWelcome,
  encodeBunInstall,
  encodeClientServerModule,
  encodeClientServerModuleManifest,
  encodeEnvConfig,
  encodeFallbackMessageContainer,
  encodeFileHandle,
  encodeFrameworkConfig,
  encodeFrameworkEntryPoint,
  encodeFrameworkEntryPointMap,
  encodeFrameworkEntryPointMessage,
  encodeGetTestsRequest,
  encodeGetTestsResponse,
  encodeJSException,
  encodeJSX,
  encodeJavascriptBundle,
  encodeJavascriptBundleContainer,
  encodeJavascriptBundledModule,
  encodeJavascriptBundledPackage,
  encodeLoadedEnvConfig,
  encodeLoadedFramework,
  encodeLoadedRouteConfig,
  encodeLoaderMap,
  encodeLocation,
  encodeLog,
  encodeMessage,
  encodeMessageData,
  encodeMessageMeta,
  encodeModule,
  encodeModuleImportRecord,
  encodeNPMRegistry,
  encodeNPMRegistryMap,
  encodeOutputFile,
  encodeProblems,
  encodeRouteConfig,
  encodeRouter,
  encodeScan,
  encodeScanResult,
  encodeScannedImport,
  encodeSourceLine,
  encodeStackFrame,
  encodeStackFramePosition,
  encodeStackTrace,
  encodeStringMap,
  encodeStringPointer,
  encodeTestResponseItem,
  encodeTransform,
  encodeTransformOptions,
  encodeTransformResponse,
  encodeWebsocketCommand,
  encodeWebsocketCommandBuild,
  encodeWebsocketCommandBuildWithFilePath,
  encodeWebsocketCommandManifest,
  encodeWebsocketMessage,
  encodeWebsocketMessageBuildFailure,
  encodeWebsocketMessageBuildSuccess,
  encodeWebsocketMessageFileChangeNotification,
  encodeWebsocketMessageResolveID,
  encodeWebsocketMessageWelcome,
};
