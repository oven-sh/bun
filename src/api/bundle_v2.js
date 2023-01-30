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

function decodeJavascriptBundledPart(bb) {
  var result = {};

  result["code"] = decodeStringPointer(bb);
  result["dependencies_offset"] = bb.readUint32();
  result["dependencies_length"] = bb.readUint32();
  result["exports_offset"] = bb.readUint32();
  result["exports_length"] = bb.readUint32();
  result["from_module"] = bb.readUint32();
  return result;
}

function encodeJavascriptBundledPart(message, bb) {
  var value = message["code"];
  if (value != null) {
    encodeStringPointer(value, bb);
  } else {
    throw new Error('Missing required field "code"');
  }

  var value = message["dependencies_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "dependencies_offset"');
  }

  var value = message["dependencies_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "dependencies_length"');
  }

  var value = message["exports_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "exports_offset"');
  }

  var value = message["exports_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "exports_length"');
  }

  var value = message["from_module"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "from_module"');
  }
}

function decodeJavascriptBundledModule(bb) {
  var result = {};

  result["path"] = decodeStringPointer(bb);
  result["parts_offset"] = bb.readUint32();
  result["parts_length"] = bb.readUint32();
  result["exports_offset"] = bb.readUint32();
  result["exports_length"] = bb.readUint32();
  result["package_id"] = bb.readUint32();
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

  var value = message["parts_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "parts_offset"');
  }

  var value = message["parts_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "parts_length"');
  }

  var value = message["exports_offset"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "exports_offset"');
  }

  var value = message["exports_length"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "exports_length"');
  }

  var value = message["package_id"];
  if (value != null) {
    bb.writeUint32(value);
  } else {
    throw new Error('Missing required field "package_id"');
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
  for (var i = 0; i < length; i++)
    values[i] = decodeJavascriptBundledModule(bb);
  var length = bb.readVarUint();
  var values = (result["packages"] = Array(length));
  for (var i = 0; i < length; i++)
    values[i] = decodeJavascriptBundledPackage(bb);
  var length = bb.readVarUint();
  var values = (result["parts"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeJavascriptBundledPart(bb);
  var length = bb.readVarUint();
  var values = (result["export_names"] = Array(length));
  for (var i = 0; i < length; i++) values[i] = decodeStringPointer(bb);
  result["export_parts"] = bb.readUint32ByteArray();
  result["etag"] = bb.readByteArray();
  result["generated_at"] = bb.readUint32();
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

  var value = message["parts"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeJavascriptBundledPart(value, bb);
    }
  } else {
    throw new Error('Missing required field "parts"');
  }

  var value = message["export_names"];
  if (value != null) {
    var values = value,
      n = values.length;
    bb.writeVarUint(n);
    for (var i = 0; i < n; i++) {
      value = values[i];
      encodeStringPointer(value, bb);
    }
  } else {
    throw new Error('Missing required field "export_names"');
  }

  var value = message["export_parts"];
  if (value != null) {
    bb.writeUint32ByteArray(value);
  } else {
    throw new Error('Missing required field "export_parts"');
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

export { decodeStringPointer };
export { encodeStringPointer };
export { decodeJavascriptBundledPart };
export { encodeJavascriptBundledPart };
export { decodeJavascriptBundledModule };
export { encodeJavascriptBundledModule };
export { decodeJavascriptBundledPackage };
export { encodeJavascriptBundledPackage };
export { decodeJavascriptBundle };
export { encodeJavascriptBundle };
export { decodeJavascriptBundleContainer };
export { encodeJavascriptBundleContainer };
