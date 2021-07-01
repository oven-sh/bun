const Loader = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "jsx": 1,
  "js": 2,
  "ts": 3,
  "tsx": 4,
  "css": 5,
  "file": 6,
  "json": 7
};
const LoaderKeys = {
  "1": "jsx",
  "2": "js",
  "3": "ts",
  "4": "tsx",
  "5": "css",
  "6": "file",
  "7": "json",
  "jsx": "jsx",
  "js": "js",
  "ts": "ts",
  "tsx": "tsx",
  "css": "css",
  "file": "file",
  "json": "json"
};
const ResolveMode = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "disable": 1,
  "lazy": 2,
  "dev": 3,
  "bundle": 4
};
const ResolveModeKeys = {
  "1": "disable",
  "2": "lazy",
  "3": "dev",
  "4": "bundle",
  "disable": "disable",
  "lazy": "lazy",
  "dev": "dev",
  "bundle": "bundle"
};
const Platform = {
  "1": 1,
  "2": 2,
  "3": 3,
  "browser": 1,
  "node": 2,
  "speedy": 3
};
const PlatformKeys = {
  "1": "browser",
  "2": "node",
  "3": "speedy",
  "browser": "browser",
  "node": "node",
  "speedy": "speedy"
};
const JSXRuntime = {
  "1": 1,
  "2": 2,
  "automatic": 1,
  "classic": 2
};
const JSXRuntimeKeys = {
  "1": "automatic",
  "2": "classic",
  "automatic": "automatic",
  "classic": "classic"
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
    throw new Error("Missing required field \"factory\"");
  }

  var value = message["runtime"];
  if (value != null) {
    var encoded = JSXRuntime[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"JSXRuntime\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"runtime\"");
  }

  var value = message["fragment"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"fragment\"");
  }

  var value = message["development"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error("Missing required field \"development\"");
  }

  var value = message["import_source"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"import_source\"");
  }

  var value = message["react_fast_refresh"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error("Missing required field \"react_fast_refresh\"");
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
    throw new Error("Missing required field \"offset\"");
  }

  var value = message["length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"length\"");
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
    throw new Error("Missing required field \"path\"");
  }

  var value = message["code"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error("Missing required field \"code\"");
  }

  var value = message["package_id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"package_id\"");
  }

  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"id\"");
  }

  var value = message["path_extname_length"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error("Missing required field \"path_extname_length\"");
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
    throw new Error("Missing required field \"name\"");
  }

  var value = message["version"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error("Missing required field \"version\"");
  }

  var value = message["hash"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"hash\"");
  }

  var value = message["modules_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"modules_offset\"");
  }

  var value = message["modules_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"modules_length\"");
  }

}

function decodeJavascriptBundle(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = result["modules"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeJavascriptBundledModule(bb);
  var length = bb.readVarUint();
  var values = result["packages"] = Array(length);
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
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJavascriptBundledModule(value, bb);
    }
  } else {
    throw new Error("Missing required field \"modules\"");
  }

  var value = message["packages"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJavascriptBundledPackage(value, bb);
    }
  } else {
    throw new Error("Missing required field \"packages\"");
  }

  var value = message["etag"];
  if (value != null) {
   bb.writeByteArray(value);
  } else {
    throw new Error("Missing required field \"etag\"");
  }

  var value = message["generated_at"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"generated_at\"");
  }

  var value = message["app_package_json_dependencies_hash"];
  if (value != null) {
   bb.writeByteArray(value);
  } else {
    throw new Error("Missing required field \"app_package_json_dependencies_hash\"");
  }

  var value = message["import_from_name"];
  if (value != null) {
   bb.writeByteArray(value);
  } else {
    throw new Error("Missing required field \"import_from_name\"");
  }

  var value = message["manifest_string"];
  if (value != null) {
   bb.writeByteArray(value);
  } else {
    throw new Error("Missing required field \"manifest_string\"");
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

    case 2:
      result["bundle"] = decodeJavascriptBundle(bb);
      break;

    case 3:
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

  var value = message["bundle"];
  if (value != null) {
    bb.writeByte(2);
    encodeJavascriptBundle(value, bb);
  }

  var value = message["code_length"];
  if (value != null) {
    bb.writeByte(3);
    bb.writeUint32(value);
  }
  bb.writeByte(0);

}
const ScanDependencyMode = {
  "1": 1,
  "2": 2,
  "app": 1,
  "all": 2
};
const ScanDependencyModeKeys = {
  "1": "app",
  "2": "all",
  "app": "app",
  "all": "all"
};
const ModuleImportType = {
  "1": 1,
  "2": 2,
  "import": 1,
  "require": 2
};
const ModuleImportTypeKeys = {
  "1": "import",
  "2": "require",
  "import": "import",
  "require": "require"
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
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"ModuleImportType\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"kind\"");
  }

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"path\"");
  }

  var value = message["dynamic"];
  if (value != null) {
    bb.writeByte(value);
  } else {
    throw new Error("Missing required field \"dynamic\"");
  }

}

function decodeModule(bb) {
  var result = {};

  result["path"] = bb.readString();
  var length = bb.readVarUint();
  var values = result["imports"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeModuleImportRecord(bb);
  return result;
}

function encodeModule(message, bb) {

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"path\"");
  }

  var value = message["imports"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeModuleImportRecord(value, bb);
    }
  } else {
    throw new Error("Missing required field \"imports\"");
  }

}

function decodeStringMap(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = result["keys"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = result["values"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  return result;
}

function encodeStringMap(message, bb) {

  var value = message["keys"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error("Missing required field \"keys\"");
  }

  var value = message["values"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error("Missing required field \"values\"");
  }

}

function decodeLoaderMap(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = result["extensions"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = bb.readString();
  var length = bb.readVarUint();
  var values = result["loaders"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = Loader[bb.readByte()];
  return result;
}

function encodeLoaderMap(message, bb) {

  var value = message["extensions"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  } else {
    throw new Error("Missing required field \"extensions\"");
  }

  var value = message["loaders"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
    }
  } else {
    throw new Error("Missing required field \"loaders\"");
  }

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
      result["public_url"] = bb.readString();
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
      var values = result["entry_points"] = Array(length);
      for (var i = 0; i < length; i++) values[i] = bb.readString();
      break;

    case 9:
      result["write"] = !!bb.readByte();
      break;

    case 10:
      var length = bb.readVarUint();
      var values = result["inject"] = Array(length);
      for (var i = 0; i < length; i++) values[i] = bb.readString();
      break;

    case 11:
      result["output_dir"] = bb.readString();
      break;

    case 12:
      var length = bb.readVarUint();
      var values = result["external"] = Array(length);
      for (var i = 0; i < length; i++) values[i] = bb.readString();
      break;

    case 13:
      result["loaders"] = decodeLoaderMap(bb);
      break;

    case 14:
      var length = bb.readVarUint();
      var values = result["main_fields"] = Array(length);
      for (var i = 0; i < length; i++) values[i] = bb.readString();
      break;

    case 15:
      result["platform"] = Platform[bb.readByte()];
      break;

    case 16:
      result["serve"] = !!bb.readByte();
      break;

    case 17:
      var length = bb.readVarUint();
      var values = result["extension_order"] = Array(length);
      for (var i = 0; i < length; i++) values[i] = bb.readString();
      break;

    case 18:
      result["public_dir"] = bb.readString();
      break;

    case 19:
      result["only_scan_dependencies"] = ScanDependencyMode[bb.readByte()];
      break;

    case 20:
      result["generate_node_module_bundle"] = !!bb.readByte();
      break;

    case 21:
      result["node_modules_bundle_path"] = bb.readString();
      break;

    case 22:
      result["javascript_framework_file"] = bb.readString();
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
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"ResolveMode\"");
bb.writeByte(encoded);
  }

  var value = message["public_url"];
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
    var values = value, n = values.length;
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
    var values = value, n = values.length;
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
    var values = value, n = values.length;
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
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["platform"];
  if (value != null) {
    bb.writeByte(15);
    var encoded = Platform[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Platform\"");
bb.writeByte(encoded);
  }

  var value = message["serve"];
  if (value != null) {
    bb.writeByte(16);
    bb.writeByte(value);
  }

  var value = message["extension_order"];
  if (value != null) {
    bb.writeByte(17);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }

  var value = message["public_dir"];
  if (value != null) {
    bb.writeByte(18);
    bb.writeString(value);
  }

  var value = message["only_scan_dependencies"];
  if (value != null) {
    bb.writeByte(19);
    var encoded = ScanDependencyMode[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"ScanDependencyMode\"");
bb.writeByte(encoded);
  }

  var value = message["generate_node_module_bundle"];
  if (value != null) {
    bb.writeByte(20);
    bb.writeByte(value);
  }

  var value = message["node_modules_bundle_path"];
  if (value != null) {
    bb.writeByte(21);
    bb.writeString(value);
  }

  var value = message["javascript_framework_file"];
  if (value != null) {
    bb.writeByte(22);
    bb.writeString(value);
  }
  bb.writeByte(0);

}

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
    throw new Error("Missing required field \"path\"");
  }

  var value = message["size"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error("Missing required field \"size\"");
  }

  var value = message["fd"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error("Missing required field \"fd\"");
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
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  }

  var value = message["options"];
  if (value != null) {
    bb.writeByte(5);
    encodeTransformOptions(value, bb);
  }
  bb.writeByte(0);

}
const TransformResponseStatus = {
  "1": 1,
  "2": 2,
  "success": 1,
  "fail": 2
};
const TransformResponseStatusKeys = {
  "1": "success",
  "2": "fail",
  "success": "success",
  "fail": "fail"
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
    throw new Error("Missing required field \"data\"");
  }

  var value = message["path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"path\"");
  }

}

function decodeTransformResponse(bb) {
  var result = {};

  result["status"] = TransformResponseStatus[bb.readVarUint()];
  var length = bb.readVarUint();
  var values = result["files"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeOutputFile(bb);
  var length = bb.readVarUint();
  var values = result["errors"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeMessage(bb);
  return result;
}

function encodeTransformResponse(message, bb) {

  var value = message["status"];
  if (value != null) {
    var encoded = TransformResponseStatus[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"TransformResponseStatus\"");
bb.writeVarUint(encoded);
  } else {
    throw new Error("Missing required field \"status\"");
  }

  var value = message["files"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeOutputFile(value, bb);
    }
  } else {
    throw new Error("Missing required field \"files\"");
  }

  var value = message["errors"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else {
    throw new Error("Missing required field \"errors\"");
  }

}
const MessageKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "err": 1,
  "warn": 2,
  "note": 3,
  "debug": 4
};
const MessageKindKeys = {
  "1": "err",
  "2": "warn",
  "3": "note",
  "4": "debug",
  "err": "err",
  "warn": "warn",
  "note": "note",
  "debug": "debug"
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
    throw new Error("Missing required field \"file\"");
  }

  var value = message["namespace"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"namespace\"");
  }

  var value = message["line"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error("Missing required field \"line\"");
  }

  var value = message["column"];
  if (value != null) {
    bb.writeInt32(value);
  } else {
    throw new Error("Missing required field \"column\"");
  }

  var value = message["line_text"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"line_text\"");
  }

  var value = message["suggestion"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"suggestion\"");
  }

  var value = message["offset"];
  if (value != null) {
    bb.writeVarUint(value);
  } else {
    throw new Error("Missing required field \"offset\"");
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

function decodeMessage(bb) {
  var result = {};

  result["kind"] = MessageKind[bb.readVarUint()];
  result["data"] = decodeMessageData(bb);
  var length = bb.readVarUint();
  var values = result["notes"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeMessageData(bb);
  return result;
}

function encodeMessage(message, bb) {

  var value = message["kind"];
  if (value != null) {
    var encoded = MessageKind[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"MessageKind\"");
bb.writeVarUint(encoded);
  } else {
    throw new Error("Missing required field \"kind\"");
  }

  var value = message["data"];
  if (value != null) {
    encodeMessageData(value, bb);
  } else {
    throw new Error("Missing required field \"data\"");
  }

  var value = message["notes"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessageData(value, bb);
    }
  } else {
    throw new Error("Missing required field \"notes\"");
  }

}

function decodeLog(bb) {
  var result = {};

  result["warnings"] = bb.readUint32();
  result["errors"] = bb.readUint32();
  var length = bb.readVarUint();
  var values = result["msgs"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeMessage(bb);
  return result;
}

function encodeLog(message, bb) {

  var value = message["warnings"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"warnings\"");
  }

  var value = message["errors"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"errors\"");
  }

  var value = message["msgs"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else {
    throw new Error("Missing required field \"msgs\"");
  }

}
const Reloader = {
  "1": 1,
  "2": 2,
  "3": 3,
  "disable": 1,
  "live": 2,
  "fast_refresh": 3
};
const ReloaderKeys = {
  "1": "disable",
  "2": "live",
  "3": "fast_refresh",
  "disable": "disable",
  "live": "live",
  "fast_refresh": "fast_refresh"
};
const WebsocketMessageKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "welcome": 1,
  "file_change_notification": 2,
  "build_success": 3,
  "build_fail": 4,
  "manifest_success": 5,
  "manifest_fail": 6
};
const WebsocketMessageKindKeys = {
  "1": "welcome",
  "2": "file_change_notification",
  "3": "build_success",
  "4": "build_fail",
  "5": "manifest_success",
  "6": "manifest_fail",
  "welcome": "welcome",
  "file_change_notification": "file_change_notification",
  "build_success": "build_success",
  "build_fail": "build_fail",
  "manifest_success": "manifest_success",
  "manifest_fail": "manifest_fail"
};
const WebsocketCommandKind = {
  "1": 1,
  "2": 2,
  "build": 1,
  "manifest": 2
};
const WebsocketCommandKindKeys = {
  "1": "build",
  "2": "manifest",
  "build": "build",
  "manifest": "manifest"
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
    throw new Error("Missing required field \"timestamp\"");
  }

  var value = message["kind"];
  if (value != null) {
    var encoded = WebsocketMessageKind[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"WebsocketMessageKind\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"kind\"");
  }

}

function decodeWebsocketMessageWelcome(bb) {
  var result = {};

  result["epoch"] = bb.readUint32();
  result["javascriptReloader"] = Reloader[bb.readByte()];
  return result;
}

function encodeWebsocketMessageWelcome(message, bb) {

  var value = message["epoch"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"epoch\"");
  }

  var value = message["javascriptReloader"];
  if (value != null) {
    var encoded = Reloader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Reloader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"javascriptReloader\"");
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
    throw new Error("Missing required field \"id\"");
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"loader\"");
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
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"WebsocketCommandKind\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"kind\"");
  }

  var value = message["timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"timestamp\"");
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
    throw new Error("Missing required field \"id\"");
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
    throw new Error("Missing required field \"id\"");
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
    throw new Error("Missing required field \"id\"");
  }

  var value = message["from_timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"from_timestamp\"");
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"loader\"");
  }

  var value = message["module_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"module_path\"");
  }

  var value = message["blob_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"blob_length\"");
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
    throw new Error("Missing required field \"id\"");
  }

  var value = message["from_timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"from_timestamp\"");
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"loader\"");
  }

  var value = message["module_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"module_path\"");
  }

  var value = message["log"];
  if (value != null) {
    encodeLog(value, bb);
  } else {
    throw new Error("Missing required field \"log\"");
  }

}

function decodeDependencyManifest(bb) {
  var result = {};

  result["ids"] = bb.readUint32ByteArray();
  return result;
}

function encodeDependencyManifest(message, bb) {

  var value = message["ids"];
  if (value != null) {
   bb.writeUint32ByteArray(value);
  } else {
    throw new Error("Missing required field \"ids\"");
  }

}

function decodeFileList(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = result["ptrs"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeStringPointer(bb);
  result["files"] = bb.readString();
  return result;
}

function encodeFileList(message, bb) {

  var value = message["ptrs"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeStringPointer(value, bb);
    }
  } else {
    throw new Error("Missing required field \"ptrs\"");
  }

  var value = message["files"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"files\"");
  }

}

function decodeWebsocketMessageResolveIDs(bb) {
  var result = {};

  result["id"] = bb.readUint32ByteArray();
  result["list"] = decodeFileList(bb);
  return result;
}

function encodeWebsocketMessageResolveIDs(message, bb) {

  var value = message["id"];
  if (value != null) {
   bb.writeUint32ByteArray(value);
  } else {
    throw new Error("Missing required field \"id\"");
  }

  var value = message["list"];
  if (value != null) {
    encodeFileList(value, bb);
  } else {
    throw new Error("Missing required field \"list\"");
  }

}

function decodeWebsocketCommandResolveIDs(bb) {
  var result = {};

  var length = bb.readVarUint();
  var values = result["ptrs"] = Array(length);
  for (var i = 0; i < length; i++) values[i] = decodeStringPointer(bb);
  result["files"] = bb.readString();
  return result;
}

function encodeWebsocketCommandResolveIDs(message, bb) {

  var value = message["ptrs"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeStringPointer(value, bb);
    }
  } else {
    throw new Error("Missing required field \"ptrs\"");
  }

  var value = message["files"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"files\"");
  }

}

function decodeWebsocketMessageManifestSuccess(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["module_path"] = bb.readString();
  result["loader"] = Loader[bb.readByte()];
  result["manifest"] = decodeDependencyManifest(bb);
  return result;
}

function encodeWebsocketMessageManifestSuccess(message, bb) {

  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"id\"");
  }

  var value = message["module_path"];
  if (value != null) {
    bb.writeString(value);
  } else {
    throw new Error("Missing required field \"module_path\"");
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"loader\"");
  }

  var value = message["manifest"];
  if (value != null) {
    encodeDependencyManifest(value, bb);
  } else {
    throw new Error("Missing required field \"manifest\"");
  }

}

function decodeWebsocketMessageManifestFailure(bb) {
  var result = {};

  result["id"] = bb.readUint32();
  result["from_timestamp"] = bb.readUint32();
  result["loader"] = Loader[bb.readByte()];
  result["log"] = decodeLog(bb);
  return result;
}

function encodeWebsocketMessageManifestFailure(message, bb) {

  var value = message["id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"id\"");
  }

  var value = message["from_timestamp"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error("Missing required field \"from_timestamp\"");
  }

  var value = message["loader"];
  if (value != null) {
    var encoded = Loader[value];
if (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
bb.writeByte(encoded);
  } else {
    throw new Error("Missing required field \"loader\"");
  }

  var value = message["log"];
  if (value != null) {
    encodeLog(value, bb);
  } else {
    throw new Error("Missing required field \"log\"");
  }

}

export { Loader }
export { LoaderKeys }
export { ResolveMode }
export { ResolveModeKeys }
export { Platform }
export { PlatformKeys }
export { JSXRuntime }
export { JSXRuntimeKeys }
export { decodeJSX }
export { encodeJSX }
export { decodeStringPointer }
export { encodeStringPointer }
export { decodeJavascriptBundledModule }
export { encodeJavascriptBundledModule }
export { decodeJavascriptBundledPackage }
export { encodeJavascriptBundledPackage }
export { decodeJavascriptBundle }
export { encodeJavascriptBundle }
export { decodeJavascriptBundleContainer }
export { encodeJavascriptBundleContainer }
export { ScanDependencyMode }
export { ScanDependencyModeKeys }
export { ModuleImportType }
export { ModuleImportTypeKeys }
export { decodeModuleImportRecord }
export { encodeModuleImportRecord }
export { decodeModule }
export { encodeModule }
export { decodeStringMap }
export { encodeStringMap }
export { decodeLoaderMap }
export { encodeLoaderMap }
export { decodeTransformOptions }
export { encodeTransformOptions }
export { decodeFileHandle }
export { encodeFileHandle }
export { decodeTransform }
export { encodeTransform }
export { TransformResponseStatus }
export { TransformResponseStatusKeys }
export { decodeOutputFile }
export { encodeOutputFile }
export { decodeTransformResponse }
export { encodeTransformResponse }
export { MessageKind }
export { MessageKindKeys }
export { decodeLocation }
export { encodeLocation }
export { decodeMessageData }
export { encodeMessageData }
export { decodeMessage }
export { encodeMessage }
export { decodeLog }
export { encodeLog }
export { Reloader }
export { ReloaderKeys }
export { WebsocketMessageKind }
export { WebsocketMessageKindKeys }
export { WebsocketCommandKind }
export { WebsocketCommandKindKeys }
export { decodeWebsocketMessage }
export { encodeWebsocketMessage }
export { decodeWebsocketMessageWelcome }
export { encodeWebsocketMessageWelcome }
export { decodeWebsocketMessageFileChangeNotification }
export { encodeWebsocketMessageFileChangeNotification }
export { decodeWebsocketCommand }
export { encodeWebsocketCommand }
export { decodeWebsocketCommandBuild }
export { encodeWebsocketCommandBuild }
export { decodeWebsocketCommandManifest }
export { encodeWebsocketCommandManifest }
export { decodeWebsocketMessageBuildSuccess }
export { encodeWebsocketMessageBuildSuccess }
export { decodeWebsocketMessageBuildFailure }
export { encodeWebsocketMessageBuildFailure }
export { decodeDependencyManifest }
export { encodeDependencyManifest }
export { decodeFileList }
export { encodeFileList }
export { decodeWebsocketMessageResolveIDs }
export { encodeWebsocketMessageResolveIDs }
export { decodeWebsocketCommandResolveIDs }
export { encodeWebsocketCommandResolveIDs }
export { decodeWebsocketMessageManifestSuccess }
export { encodeWebsocketMessageManifestSuccess }
export { decodeWebsocketMessageManifestFailure }
export { encodeWebsocketMessageManifestFailure }