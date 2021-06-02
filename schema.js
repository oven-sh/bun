const Loader = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  jsx: 1,
  js: 2,
  ts: 3,
  tsx: 4,
  css: 5,
  file: 6,
  json: 7
};
const LoaderKeys = {
  "1": "jsx",
  "2": "js",
  "3": "ts",
  "4": "tsx",
  "5": "css",
  "6": "file",
  "7": "json",
  jsx: "jsx",
  js: "js",
  ts: "ts",
  tsx: "tsx",
  css: "css",
  file: "file",
  json: "json"
};
const ResolveMode = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  disable: 1,
  lazy: 2,
  dev: 3,
  bundle: 4
};
const ResolveModeKeys = {
  "1": "disable",
  "2": "lazy",
  "3": "dev",
  "4": "bundle",
  disable: "disable",
  lazy: "lazy",
  dev: "dev",
  bundle: "bundle"
};
const Platform = {
  "1": 1,
  "2": 2,
  browser: 1,
  node: 2
};
const PlatformKeys = {
  "1": "browser",
  "2": "node",
  browser: "browser",
  node: "node"
};
const JSXRuntime = {
  "1": 1,
  "2": 2,
  automatic: 1,
  classic: 2
};
const JSXRuntimeKeys = {
  "1": "automatic",
  "2": "classic",
  automatic: "automatic",
  classic: "classic"
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
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"factory\"");
  var value = message["runtime"];
  if (value != null) {
    var encoded = JSXRuntime[value];
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"JSXRuntime\"");
    bb.writeByte(encoded);
  } else
    throw new Error("Missing required field \"runtime\"");
  var value = message["fragment"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"fragment\"");
  var value = message["development"];
  if (value != null)
    bb.writeByte(value);
  else
    throw new Error("Missing required field \"development\"");
  var value = message["import_source"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"import_source\"");
  var value = message["react_fast_refresh"];
  if (value != null)
    bb.writeByte(value);
  else
    throw new Error("Missing required field \"react_fast_refresh\"");
}
function decodeTransformOptions(bb) {
  var result = {};
  while (true)
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
        var length = bb.readVarUint();
        var values = result["define_keys"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 7:
        var length = bb.readVarUint();
        var values = result["define_values"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 8:
        result["preserve_symlinks"] = !!bb.readByte();
        break;
      case 9:
        var length = bb.readVarUint();
        var values = result["entry_points"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 10:
        result["write"] = !!bb.readByte();
        break;
      case 11:
        var length = bb.readVarUint();
        var values = result["inject"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 12:
        result["output_dir"] = bb.readString();
        break;
      case 13:
        var length = bb.readVarUint();
        var values = result["external"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 14:
        var length = bb.readVarUint();
        var values = result["loader_keys"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 15:
        var length = bb.readVarUint();
        var values = result["loader_values"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = Loader[bb.readByte()];
        break;
      case 16:
        var length = bb.readVarUint();
        var values = result["main_fields"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 17:
        result["platform"] = Platform[bb.readByte()];
        break;
      case 18:
        result["serve"] = !!bb.readByte();
        break;
      case 19:
        var length = bb.readVarUint();
        var values = result["extension_order"] = Array(length);
        for (var i = 0;i < length; i++)
          values[i] = bb.readString();
        break;
      case 20:
        result["public_dir"] = bb.readString();
        break;
      default:
        throw new Error("Attempted to parse invalid message");
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
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"ResolveMode\"");
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
  var value = message["define_keys"];
  if (value != null) {
    bb.writeByte(6);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["define_values"];
  if (value != null) {
    bb.writeByte(7);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["preserve_symlinks"];
  if (value != null) {
    bb.writeByte(8);
    bb.writeByte(value);
  }
  var value = message["entry_points"];
  if (value != null) {
    bb.writeByte(9);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["write"];
  if (value != null) {
    bb.writeByte(10);
    bb.writeByte(value);
  }
  var value = message["inject"];
  if (value != null) {
    bb.writeByte(11);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["output_dir"];
  if (value != null) {
    bb.writeByte(12);
    bb.writeString(value);
  }
  var value = message["external"];
  if (value != null) {
    bb.writeByte(13);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["loader_keys"];
  if (value != null) {
    bb.writeByte(14);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["loader_values"];
  if (value != null) {
    bb.writeByte(15);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      var encoded = Loader[value];
      if (encoded === undefined)
        throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
      bb.writeByte(encoded);
    }
  }
  var value = message["main_fields"];
  if (value != null) {
    bb.writeByte(16);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["platform"];
  if (value != null) {
    bb.writeByte(17);
    var encoded = Platform[value];
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Platform\"");
    bb.writeByte(encoded);
  }
  var value = message["serve"];
  if (value != null) {
    bb.writeByte(18);
    bb.writeByte(value);
  }
  var value = message["extension_order"];
  if (value != null) {
    bb.writeByte(19);
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      bb.writeString(value);
    }
  }
  var value = message["public_dir"];
  if (value != null) {
    bb.writeByte(20);
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
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"path\"");
  var value = message["size"];
  if (value != null)
    bb.writeVarUint(value);
  else
    throw new Error("Missing required field \"size\"");
  var value = message["fd"];
  if (value != null)
    bb.writeVarUint(value);
  else
    throw new Error("Missing required field \"fd\"");
}
function decodeTransform(bb) {
  var result = {};
  while (true)
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
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"Loader\"");
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
  success: 1,
  fail: 2
};
const TransformResponseStatusKeys = {
  "1": "success",
  "2": "fail",
  success: "success",
  fail: "fail"
};
function decodeOutputFile(bb) {
  var result = {};
  result["data"] = bb.readByteArray();
  result["path"] = bb.readString();
  return result;
}
function encodeOutputFile(message, bb) {
  var value = message["data"];
  if (value != null)
    bb.writeByteArray(value);
  else
    throw new Error("Missing required field \"data\"");
  var value = message["path"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"path\"");
}
function decodeTransformResponse(bb) {
  var result = {};
  result["status"] = TransformResponseStatus[bb.readVarUint()];
  var length = bb.readVarUint();
  var values = result["files"] = Array(length);
  for (var i = 0;i < length; i++)
    values[i] = decodeOutputFile(bb);
  var length = bb.readVarUint();
  var values = result["errors"] = Array(length);
  for (var i = 0;i < length; i++)
    values[i] = decodeMessage(bb);
  return result;
}
function encodeTransformResponse(message, bb) {
  var value = message["status"];
  if (value != null) {
    var encoded = TransformResponseStatus[value];
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"TransformResponseStatus\"");
    bb.writeVarUint(encoded);
  } else
    throw new Error("Missing required field \"status\"");
  var value = message["files"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      encodeOutputFile(value, bb);
    }
  } else
    throw new Error("Missing required field \"files\"");
  var value = message["errors"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else
    throw new Error("Missing required field \"errors\"");
}
const MessageKind = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  err: 1,
  warn: 2,
  note: 3,
  debug: 4
};
const MessageKindKeys = {
  "1": "err",
  "2": "warn",
  "3": "note",
  "4": "debug",
  err: "err",
  warn: "warn",
  note: "note",
  debug: "debug"
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
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"file\"");
  var value = message["namespace"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"namespace\"");
  var value = message["line"];
  if (value != null)
    bb.writeInt32(value);
  else
    throw new Error("Missing required field \"line\"");
  var value = message["column"];
  if (value != null)
    bb.writeInt32(value);
  else
    throw new Error("Missing required field \"column\"");
  var value = message["line_text"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"line_text\"");
  var value = message["suggestion"];
  if (value != null)
    bb.writeString(value);
  else
    throw new Error("Missing required field \"suggestion\"");
  var value = message["offset"];
  if (value != null)
    bb.writeVarUint(value);
  else
    throw new Error("Missing required field \"offset\"");
}
function decodeMessageData(bb) {
  var result = {};
  while (true)
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
  for (var i = 0;i < length; i++)
    values[i] = decodeMessageData(bb);
  return result;
}
function encodeMessage(message, bb) {
  var value = message["kind"];
  if (value != null) {
    var encoded = MessageKind[value];
    if (encoded === undefined)
      throw new Error("Invalid value " + JSON.stringify(value) + " for enum \"MessageKind\"");
    bb.writeVarUint(encoded);
  } else
    throw new Error("Missing required field \"kind\"");
  var value = message["data"];
  if (value != null)
    encodeMessageData(value, bb);
  else
    throw new Error("Missing required field \"data\"");
  var value = message["notes"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      encodeMessageData(value, bb);
    }
  } else
    throw new Error("Missing required field \"notes\"");
}
function decodeLog(bb) {
  var result = {};
  result["warnings"] = bb.readUint32();
  result["errors"] = bb.readUint32();
  var length = bb.readVarUint();
  var values = result["msgs"] = Array(length);
  for (var i = 0;i < length; i++)
    values[i] = decodeMessage(bb);
  return result;
}
function encodeLog(message, bb) {
  var value = message["warnings"];
  if (value != null)
    bb.writeUint32(value);
  else
    throw new Error("Missing required field \"warnings\"");
  var value = message["errors"];
  if (value != null)
    bb.writeUint32(value);
  else
    throw new Error("Missing required field \"errors\"");
  var value = message["msgs"];
  if (value != null) {
    var values = value, n = values.length;
    bb.writeVarUint(n);
    for (var i = 0;i < n; i++) {
      value = values[i];
      encodeMessage(value, bb);
    }
  } else
    throw new Error("Missing required field \"msgs\"");
}

export {Loader};
export {LoaderKeys};
export {ResolveMode};
export {ResolveModeKeys};
export {Platform};
export {PlatformKeys};
export {JSXRuntime};
export {JSXRuntimeKeys};
export {decodeJSX};
export {encodeJSX};
export {decodeTransformOptions};
export {encodeTransformOptions};
export {decodeFileHandle};
export {encodeFileHandle};
export {decodeTransform};
export {encodeTransform};
export {TransformResponseStatus};
export {TransformResponseStatusKeys};
export {decodeOutputFile};
export {encodeOutputFile};
export {decodeTransformResponse};
export {encodeTransformResponse};
export {MessageKind};
export {MessageKindKeys};
export {decodeLocation};
export {encodeLocation};
export {decodeMessageData};
export {encodeMessageData};
export {decodeMessage};
export {encodeMessage};
export {decodeLog};
export {encodeLog};
