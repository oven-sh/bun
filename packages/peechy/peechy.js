var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value,
      })
    : (obj[key] = value);
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// bb.ts
var int32 = new Int32Array(1);
var float32 = new Float32Array(int32.buffer);
var int16 = new Int16Array(int32.buffer);
var uint16 = new Uint16Array(int32.buffer);
var uint32 = new Uint32Array(int32.buffer);
var uint8Buffer = new Uint8Array(int32.buffer);
var int8Buffer = new Int8Array(int32.buffer);
var textDecoder;
var textEncoder;
var ArrayBufferType =
  typeof SharedArrayBuffer !== "undefined" ? SharedArrayBuffer : ArrayBuffer;
var _ByteBuffer = class {
  data;
  index;
  length;
  constructor(data, addViews = false) {
    if (data && !(data instanceof Uint8Array)) {
      throw new Error("Must initialize a ByteBuffer with a Uint8Array");
    }
    this.data = data || new Uint8Array(256);
    this.index = 0;
    this.length = data ? data.length : 0;
  }
  toUint8Array() {
    return this.data.subarray(0, this.length);
  }
  readByte() {
    if (this.index + 1 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    return this.data[this.index++];
  }
  readAlphanumeric() {
    if (!textDecoder) {
      textDecoder = new TextDecoder("utf-8");
    }
    let start = this.index;
    let char = 256;
    const end = this.length - 1;
    while (this.index < end && char > 0) {
      char = this.data[this.index++];
    }
    return String.fromCharCode(...this.data.subarray(start, this.index - 1));
  }
  writeAlphanumeric(contents) {
    if (this.length + 1 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    let index = this.length;
    this._growBy(contents.length);
    const data = this.data;
    let i = 0;
    let code = 0;
    while (i < contents.length) {
      code = data[index++] = contents.charCodeAt(i++);
      if (code > 127)
        throw new Error(`Non-ascii character at char ${i - 1} :${contents}`);
    }
    this.writeByte(0);
  }
  readFloat32() {
    if (this.index + 4 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    uint8Buffer[1] = this.data[this.index++];
    uint8Buffer[2] = this.data[this.index++];
    uint8Buffer[3] = this.data[this.index++];
    return float32[0];
  }
  readByteArray() {
    let length = this.readVarUint();
    let start = this.index;
    let end = start + length;
    if (end > this.data.length) {
      throw new Error("Read array out of bounds");
    }
    this.index = end;
    let result = new Uint8Array(new ArrayBufferType(length));
    result.set(this.data.subarray(start, end));
    return result;
  }
  readUint32ByteArray() {
    const array = this.readByteArray();
    return new Uint32Array(
      array.buffer,
      0,
      array.length / Uint32Array.BYTES_PER_ELEMENT
    );
  }
  readInt8ByteArray() {
    const array = this.readByteArray();
    return new Int8Array(
      array.buffer,
      0,
      array.length / Int8Array.BYTES_PER_ELEMENT
    );
  }
  readInt16ByteArray() {
    const array = this.readByteArray();
    return new Int16Array(
      array.buffer,
      0,
      array.length / Int16Array.BYTES_PER_ELEMENT
    );
  }
  readInt32ByteArray() {
    const array = this.readByteArray();
    return new Int32Array(
      array.buffer,
      0,
      array.length / Int32Array.BYTES_PER_ELEMENT
    );
  }
  readFloat32ByteArray() {
    const array = this.readByteArray();
    return new Float32Array(
      array.buffer,
      0,
      array.length / Float32Array.BYTES_PER_ELEMENT
    );
  }
  readVarFloat() {
    let index = this.index;
    let data = this.data;
    let length = data.length;
    if (index + 1 > length) {
      throw new Error("Index out of bounds");
    }
    let first = data[index];
    if (first === 0) {
      this.index = index + 1;
      return 0;
    }
    if (index + 4 > length) {
      throw new Error("Index out of bounds");
    }
    let bits =
      first |
      (data[index + 1] << 8) |
      (data[index + 2] << 16) |
      (data[index + 3] << 24);
    this.index = index + 4;
    bits = (bits << 23) | (bits >>> 9);
    int32[0] = bits;
    return float32[0];
  }
  readUint32() {
    if (this.index + 4 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    uint8Buffer[1] = this.data[this.index++];
    uint8Buffer[2] = this.data[this.index++];
    uint8Buffer[3] = this.data[this.index++];
    return uint32[0];
  }
  readUint16() {
    if (this.index + 2 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    uint8Buffer[1] = this.data[this.index++];
    return uint16[0];
  }
  readVarUint() {
    return this.readUint32();
  }
  readInt32() {
    if (this.index + 4 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    uint8Buffer[1] = this.data[this.index++];
    uint8Buffer[2] = this.data[this.index++];
    uint8Buffer[3] = this.data[this.index++];
    return int32[0];
  }
  readInt16() {
    if (this.index + 2 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    uint8Buffer[1] = this.data[this.index++];
    return int16[0];
  }
  readInt8() {
    if (this.index + 1 > this.data.length) {
      throw new Error("Index out of bounds");
    }
    uint8Buffer[0] = this.data[this.index++];
    return int8Buffer[0];
  }
  readVarInt() {
    return this.readInt32();
  }
  readString() {
    const length = this.readVarUint();
    let start = this.index;
    this.index += length;
    if (!textDecoder) {
      textDecoder = new TextDecoder("utf8");
    }
    return textDecoder.decode(this.data.subarray(start, this.index));
  }
  _growBy(amount) {
    if (this.length + amount > this.data.length) {
      let data = new Uint8Array(
        Math.imul(this.length + amount, _ByteBuffer.WIGGLE_ROOM) << 1
      );
      data.set(this.data);
      this.data = data;
    }
    this.length += amount;
  }
  writeByte(value) {
    let index = this.length;
    this._growBy(1);
    this.data[index] = value;
  }
  writeByteArray(value) {
    this.writeVarUint(value.length);
    let index = this.length;
    this._growBy(value.length);
    this.data.set(value, index);
  }
  writeUint16ByteArray(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeUint32ByteArray(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeInt8ByteArray(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeInt16ByteArray(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeInt32ByteArray(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeFloat32Array(value) {
    this.writeByteArray(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  writeVarFloat(value) {
    let index = this.length;
    float32[0] = value;
    let bits = int32[0];
    bits = (bits >>> 23) | (bits << 9);
    if ((bits & 255) === 0) {
      this.writeByte(0);
      return;
    }
    this._growBy(4);
    let data = this.data;
    data[index] = bits;
    data[index + 1] = bits >> 8;
    data[index + 2] = bits >> 16;
    data[index + 3] = bits >> 24;
  }
  writeFloat32(value) {
    let index = this.length;
    this._growBy(4);
    float32[0] = value;
    this.data.set(uint8Buffer, index);
  }
  writeVarUint(value) {
    this.writeUint32(value);
  }
  writeUint16(value) {
    let index = this.length;
    this._growBy(2);
    uint16[0] = value;
    this.data[index++] = uint8Buffer[0];
    this.data[index++] = uint8Buffer[1];
  }
  writeUint32(value) {
    let index = this.length;
    this._growBy(4);
    uint32[0] = value;
    this.data.set(uint8Buffer, index);
  }
  writeVarInt(value) {
    this.writeInt32(value);
  }
  writeInt8(value) {
    let index = this.length;
    this._growBy(1);
    int8Buffer[0] = value;
    this.data[index++] = uint8Buffer[0];
  }
  writeInt16(value) {
    let index = this.length;
    this._growBy(2);
    int16[0] = value;
    this.data[index++] = uint8Buffer[0];
    this.data[index++] = uint8Buffer[1];
  }
  writeInt32(value) {
    let index = this.length;
    this._growBy(4);
    int32[0] = value;
    this.data.set(uint8Buffer, index);
  }
  writeLowPrecisionFloat(value) {
    this.writeVarInt(Math.round(_ByteBuffer.LOW_PRECISION_VALUE * value));
  }
  readLowPrecisionFloat() {
    return this.readVarInt() / _ByteBuffer.LOW_PRECISION_VALUE;
  }
  writeString(value) {
    var initial_offset = this.length;
    this.writeVarUint(value.length);
    if (!textEncoder) {
      textEncoder = new TextEncoder();
    }
    const offset = this.length;
    this._growBy(value.length * 2 + 5);
    const result = textEncoder.encodeInto(value, this.data.subarray(offset));
    this.length = offset + result.written;
    if (result.written !== value.length) {
      uint32[0] = result.written;
      this.data[initial_offset++] = uint8Buffer[0];
      this.data[initial_offset++] = uint8Buffer[1];
      this.data[initial_offset++] = uint8Buffer[2];
      this.data[initial_offset++] = uint8Buffer[3];
    }
  }
};
var ByteBuffer = _ByteBuffer;
__publicField(ByteBuffer, "WIGGLE_ROOM", 1);
__publicField(ByteBuffer, "LOW_PRECISION_VALUE", 10 ** 3);

// binary.ts
var types = [
  "bool",
  "byte",
  "float",
  "int",
  "uint8",
  "uint16",
  "uint32",
  "int8",
  "int16",
  "int32",
  "float32",
  "string",
  "uint",
];
var kinds = ["ENUM", "STRUCT", "MESSAGE", "UNION", "SMOL", "ALIAS"];
function decodeBinarySchema(buffer) {
  let bb = buffer instanceof ByteBuffer ? buffer : new ByteBuffer(buffer);
  let definitionCount = bb.readVarUint();
  let definitions = [];
  for (let i = 0; i < definitionCount; i++) {
    let definitionName = bb.readString();
    let kind = bb.readByte();
    let fieldCount = bb.readVarUint();
    let fields = [];
    for (let j = 0; j < fieldCount; j++) {
      let fieldName = bb.readString();
      let type = bb.readVarInt();
      let isArray = !!(bb.readByte() & 1);
      let isRequired = !!(bb.readByte() & 1);
      let value = bb.readVarUint();
      fields.push({
        name: fieldName,
        line: 0,
        column: 0,
        type: kinds[kind] === "ENUM" || kinds[kind] === "SMOL" ? null : type,
        isArray,
        isRequired,
        isDeprecated: false,
        value,
      });
    }
    let serializerPath = bb.readString();
    definitions.push({
      name: definitionName,
      line: 0,
      column: 0,
      kind: kinds[kind],
      fields,
      serializerPath,
    });
  }
  for (let i = 0; i < definitionCount; i++) {
    let fields = definitions[i].fields;
    for (let j = 0; j < fields.length; j++) {
      let field = fields[j];
      let type = field.type;
      if (type !== null && type < 0) {
        if (~type >= types.length) {
          throw new Error("Invalid type " + type);
        }
        field.type = types[~type];
      } else {
        if (type !== null && type >= definitions.length) {
          throw new Error("Invalid type " + type);
        }
        field.type = type === null ? null : definitions[type].name;
      }
    }
  }
  return {
    package: null,
    definitions,
  };
}

// util.ts
function quote(text) {
  return JSON.stringify(text);
}
function error(text, line, column) {
  var error2 = new Error(text);
  error2.line = line;
  error2.column = column;
  throw error2;
}

// parser.ts
var nativeTypes = [
  "bool",
  "byte",
  "float",
  "int",
  "uint8",
  "uint16",
  "uint32",
  "int8",
  "int16",
  "lowp",
  "int32",
  "float32",
  "string",
  "uint",
  "discriminator",
  "alphanumeric",
];
var nativeTypeMap = {
  bool: 1,
  byte: 1,
  float: 1,
  int: 1,
  uint8: 1,
  uint16: 1,
  uint32: 1,
  int8: 1,
  int16: 1,
  int32: 1,
  float32: 1,
  string: 1,
  uint: 1,
  discriminator: 1,
  alphanumeric: 1,
};
var reservedNames = ["ByteBuffer", "package", "Allocator"];
var regex =
  /((?:-|\b)\d+\b|[=\:;{}]|\[\]|\[deprecated\]|\[!\]|\b[A-Za-z_][A-Za-z0-9_]*\b|"|-|\&|\||\/\/.*|\s+)/g;
var identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
var whitespace = /^\/\/.*|\s+$/;
var equals = /^=$/;
var endOfFile = /^$/;
var semicolon = /^;$/;
var integer = /^-?\d+$/;
var leftBrace = /^\{$/;
var rightBrace = /^\}$/;
var arrayToken = /^\[\]$/;
var enumKeyword = /^enum$/;
var smolKeyword = /^smol$/;
var quoteToken = /^"$/;
var serializerKeyword = /^from$/;
var colon = /^:$/;
var packageKeyword = /^package$/;
var pick = /^pick$/;
var entityKeyword = /^entity$/;
var structKeyword = /^struct$/;
var aliasKeyword = /^alias$/;
var unionKeyword = /^union$/;
var messageKeyword = /^message$/;
var deprecatedToken = /^\[deprecated\]$/;
var unionOrToken = /^\|$/;
var extendsToken = /^&$/;
var requiredToken = /^\[!\]$/;
function tokenize(text) {
  let parts = text.split(regex);
  let tokens = [];
  let column = 0;
  let line = 0;
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (i & 1) {
      if (!whitespace.test(part)) {
        tokens.push({
          text: part,
          line: line + 1,
          column: column + 1,
        });
      }
    } else if (part !== "") {
      error("Syntax error " + quote(part), line + 1, column + 1);
    }
    let lines = part.split("\n");
    if (lines.length > 1) column = 0;
    line += lines.length - 1;
    column += lines[lines.length - 1].length;
  }
  tokens.push({
    text: "",
    line,
    column,
  });
  return tokens;
}
function parse(tokens) {
  function current() {
    return tokens[index];
  }
  function eat(test) {
    if (test.test(current().text)) {
      index++;
      return true;
    }
    return false;
  }
  function expect(test, expected) {
    if (!eat(test)) {
      let token = current();
      error(
        "Expected " + expected + " but found " + quote(token.text),
        token.line,
        token.column
      );
    }
  }
  function unexpectedToken() {
    let token = current();
    error("Unexpected token " + quote(token.text), token.line, token.column);
  }
  let definitions = [];
  let packageText = null;
  let index = 0;
  let picks = {};
  if (eat(packageKeyword)) {
    packageText = current().text;
    expect(identifier, "identifier");
    expect(semicolon, '";"');
  }
  let serializerPath;
  while (index < tokens.length && !eat(endOfFile)) {
    let fields = [];
    let extensions;
    let kind;
    if (eat(enumKeyword)) kind = "ENUM";
    else if (eat(smolKeyword)) kind = "SMOL";
    else if (eat(pick)) kind = "PICK";
    else if (eat(structKeyword)) kind = "STRUCT";
    else if (eat(messageKeyword)) kind = "MESSAGE";
    else if (eat(entityKeyword)) kind = "ENTITY";
    else if (eat(unionKeyword)) kind = "UNION";
    else if (eat(aliasKeyword)) kind = "ALIAS";
    else unexpectedToken();
    let name = current();
    expect(identifier, "identifier");
    if (kind === "PICK") {
      expect(colon, '":"');
      let field = current();
      expect(identifier, "identifier");
      expect(leftBrace, '"{"');
      const fieldNames = [];
      picks[name.text] = {
        to: name,
        fieldNames,
        from: field,
      };
      while (!eat(rightBrace)) {
        field = current();
        expect(identifier, "identifier");
        if (fieldNames.includes(field.text)) {
          error("Fields must be unique", field.line, field.column);
        }
        fieldNames.push(field.text);
        expect(semicolon, ";");
      }
      continue;
    } else if (kind === "UNION") {
      expect(equals, '"="');
      let field = current();
      expect(identifier, "identifier");
      fields.push({
        name: field.text,
        line: field.line,
        column: field.column,
        type: field.text,
        isArray: false,
        isRequired: true,
        isDeprecated: false,
        value: fields.length + 1,
      });
      while (eat(unionOrToken)) {
        field = current();
        expect(identifier, "identifier");
        fields.push({
          name: field.text,
          line: field.line,
          column: field.column,
          type: field.text,
          isArray: false,
          isDeprecated: false,
          isRequired: true,
          value: fields.length + 1,
        });
      }
      if (eat(leftBrace)) {
        field = current();
        expect(identifier, "discriminator name");
        fields.unshift({
          type: "discriminator",
          name: field.text,
          line: field.line,
          column: field.column,
          isArray: false,
          isDeprecated: false,
          isRequired: true,
          value: 0,
        });
        expect(semicolon, ";");
        expect(rightBrace, "}");
      } else {
        expect(semicolon, '";"');
      }
    } else if (kind === "ALIAS") {
      expect(equals, "=");
      let field = current();
      expect(identifier, "identifier");
      fields.push({
        type: field.text,
        name: field.text,
        line: field.line,
        column: field.column,
        isArray: false,
        isDeprecated: false,
        isRequired: true,
        value: 1,
      });
      expect(semicolon, ";");
    } else {
      if (kind === "STRUCT") {
        while (eat(extendsToken)) {
          let field = current();
          expect(identifier, "discriminator name");
          if (!extensions) {
            extensions = [field.text];
          } else {
            extensions.push(field.text);
          }
        }
      }
      if (eat(serializerKeyword)) {
        expect(quoteToken, '"');
        serializerPath = "";
        while (!eat(quoteToken)) {
          serializerPath += current().text;
          index++;
        }
      }
      expect(leftBrace, '"{"');
      while (!eat(rightBrace)) {
        let type = null;
        let isArray = false;
        let isDeprecated = false;
        if (kind !== "ENUM" && kind !== "SMOL") {
          type = current().text;
          expect(identifier, "identifier");
          isArray = eat(arrayToken);
        }
        let field = current();
        expect(identifier, "identifier");
        let value = null;
        let isRequired = kind === "STRUCT";
        if (kind !== "STRUCT") {
          expect(equals, '"="');
          value = current();
          expect(integer, "integer");
          if (eat(requiredToken)) {
            isRequired = true;
          }
          if ((+value.text | 0) + "" !== value.text) {
            error(
              "Invalid integer " + quote(value.text),
              value.line,
              value.column
            );
          }
        }
        let deprecated = current();
        if (eat(deprecatedToken)) {
          if (kind !== "MESSAGE") {
            error(
              "Cannot deprecate this field",
              deprecated.line,
              deprecated.column
            );
          }
          isDeprecated = true;
        }
        expect(semicolon, '";"');
        fields.push({
          name: field.text,
          line: field.line,
          column: field.column,
          type,
          isArray,
          isDeprecated,
          isRequired,
          value: value !== null ? +value.text | 0 : fields.length + 1,
        });
      }
    }
    definitions.push({
      name: name.text,
      line: name.line,
      column: name.column,
      kind,
      fields,
      extensions,
      serializerPath:
        serializerPath && serializerPath.trim().length > 0
          ? serializerPath
          : void 0,
    });
    serializerPath = "";
  }
  for (let definition of definitions) {
    if (definition.extensions) {
      for (let extension of definition.extensions) {
        let otherDefinition = definition;
        for (let i = 0; i < definitions.length; i++) {
          otherDefinition = definitions[i];
          if (extension === otherDefinition.name) {
            break;
          }
        }
        if (
          otherDefinition.name !== extension ||
          otherDefinition.kind !== "STRUCT"
        ) {
          error(
            `Expected ${otherDefinition.name} to to be a struct`,
            definition.line,
            definition.column
          );
        }
        let offset = definition.fields.length;
        for (let field of otherDefinition.fields) {
          definition.fields.push({
            ...field,
            value: field.value + offset,
          });
        }
      }
    }
  }
  let foundMatch = false;
  for (let partName in picks) {
    const pick2 = picks[partName];
    const token = pick2.from;
    let definition = definitions[0];
    for (let i = 0; i < definitions.length; i++) {
      definition = definitions[i];
      if (definition.name === token.text) {
        foundMatch = true;
        break;
      }
    }
    if (!foundMatch) {
      error("Expected type for part to exist", token.line, token.column);
    }
    foundMatch = false;
    const fields = new Array(pick2.fieldNames.length);
    let field = definition.fields[0];
    for (let i = 0; i < fields.length; i++) {
      let name = pick2.fieldNames[i];
      foundMatch = false;
      field = definition.fields[0];
      for (let j = 0; j < definition.fields.length; j++) {
        if (definition.fields[j].name === name) {
          field = definition.fields[j];
          foundMatch = true;
        }
      }
      if (!foundMatch) {
        error(
          `Expected field ${name} to exist in ${definition.name}`,
          token.line,
          token.column
        );
      }
      fields[i] = {
        name: field.name,
        line: field.line,
        column: field.column,
        type: field.type,
        isRequired: true,
        isArray: field.isArray,
        isDeprecated: field.isDeprecated,
        value: i + 1,
      };
    }
    definitions.push({
      name: pick2.to.text,
      line: token.line,
      column: token.column,
      kind: "STRUCT",
      fields,
    });
  }
  return {
    package: packageText,
    definitions,
  };
}
function verify(root) {
  let definedTypes = nativeTypes.slice();
  let definitions = {};
  for (let i = 0; i < root.definitions.length; i++) {
    let definition = root.definitions[i];
    if (definedTypes.indexOf(definition.name) !== -1) {
      error(
        "The type " + quote(definition.name) + " is defined twice",
        definition.line,
        definition.column
      );
    }
    if (reservedNames.indexOf(definition.name) !== -1) {
      error(
        "The type name " + quote(definition.name) + " is reserved",
        definition.line,
        definition.column
      );
    }
    definedTypes.push(definition.name);
    definitions[definition.name] = definition;
  }
  for (let i = 0; i < root.definitions.length; i++) {
    let definition = root.definitions[i];
    let fields = definition.fields;
    if (
      definition.kind === "ENUM" ||
      definition.kind === "SMOL" ||
      fields.length === 0
    ) {
      continue;
    }
    if (definition.kind === "UNION") {
      let state2 = {};
      for (let j = 0; j < fields.length; j++) {
        let field = fields[j];
        if (state2[field.name]) {
          error(
            "The type " +
              quote(field.type) +
              " can only appear in  " +
              quote(definition.name) +
              " once.",
            field.line,
            field.column
          );
        }
        state2[field.name] = 1;
        if (definedTypes.indexOf(field.type) === -1) {
          error(
            "The type " +
              quote(field.type) +
              " is not defined for union " +
              quote(definition.name),
            field.line,
            field.column
          );
        }
      }
    } else if (definition.kind === "ALIAS") {
      const field = definition.fields[0];
      if (!field)
        error("Expected alias name", definition.line, definition.column);
      if (!(definitions[field.name] || nativeTypeMap[field.name])) {
        error(
          "Expected type used in alias to exist.",
          definition.line,
          definition.column
        );
      }
    } else {
      for (let j = 0; j < fields.length; j++) {
        let field = fields[j];
        if (definedTypes.indexOf(field.type) === -1) {
          error(
            "The type " +
              quote(field.type) +
              " is not defined for field " +
              quote(field.name),
            field.line,
            field.column
          );
        }
        if (field.type === "discriminator") {
          error(
            "discriminator is only available inside of unions.",
            field.line,
            field.column
          );
        }
      }
    }
    let values = [];
    for (let j = 0; j < fields.length; j++) {
      let field = fields[j];
      if (values.indexOf(field.value) !== -1) {
        error(
          "The id for field " + quote(field.name) + " is used twice",
          field.line,
          field.column
        );
      }
      if (field.value <= 0 && field.type !== "discriminator") {
        error(
          "The id for field " + quote(field.name) + " must be positive",
          field.line,
          field.column
        );
      }
      if (field.value > fields.length) {
        error(
          "The id for field " +
            quote(field.name) +
            " cannot be larger than " +
            fields.length,
          field.line,
          field.column
        );
      }
      values.push(field.value);
    }
  }
  let state = {};
  let check = (name) => {
    let definition = definitions[name];
    if (definition && definition.kind === "STRUCT") {
      if (state[name] === 1) {
        error(
          "Recursive nesting of " + quote(name) + " is not allowed",
          definition.line,
          definition.column
        );
      }
      if (state[name] !== 2 && definition) {
        state[name] = 1;
        let fields = definition.fields;
        for (let i = 0; i < fields.length; i++) {
          let field = fields[i];
          if (!field.isArray) {
            check(field.type);
          }
        }
        state[name] = 2;
      }
    }
    return true;
  };
  for (let i = 0; i < root.definitions.length; i++) {
    check(root.definitions[i].name);
  }
}
function parseSchema(text) {
  const schema = parse(tokenize(text));
  verify(schema);
  return schema;
}

// js.ts
function isDiscriminatedUnion(name, definitions) {
  if (!definitions[name]) return false;
  if (!definitions[name].fields.length) return false;
  return definitions[name].fields[0].type === "discriminator";
}
function compileDecode(
  functionName,
  definition,
  definitions,
  withAllocator = false,
  aliases
) {
  let lines = [];
  let indent = "  ";
  if (definition.kind === "UNION") {
    const hasDiscriminator = isDiscriminatedUnion(definition.name, definitions);
    if (hasDiscriminator) {
      lines.push(`function ${functionName}(bb) {`);
    } else {
      lines.push(`function ${functionName}(bb, type = 0) {`);
    }
    lines.push("");
    if (hasDiscriminator) {
      lines.push("  switch (bb.readByte()) {");
      indent = "      ";
      for (let i = 1; i < definition.fields.length; i++) {
        let field = definition.fields[i];
        lines.push(
          `    case ${field.value}:`,
          indent + "var result = " + ("decode" + field.name) + "(bb);",
          indent +
            `result[${quote(definition.fields[0].name)}] = ${field.value};`,
          indent + `return result;`
        );
      }
    } else {
      lines.push("  switch (type) {");
      indent = "      ";
      for (let i = 0; i < definition.fields.length; i++) {
        let field = definition.fields[i];
        lines.push(
          `    case ${field.value}:`,
          indent + `return ${"decode" + field.name}(bb)`
        );
      }
    }
  } else {
    lines.push(`function ${functionName}(bb) {`);
    if (!withAllocator) {
      lines.push("  var result = {};");
    } else {
      lines.push(
        "  var result = Allocator[" + quote(definition.name) + "].alloc();"
      );
    }
    lines.push("");
    if (definition.kind === "MESSAGE") {
      lines.push("  while (true) {");
      lines.push("    switch (bb.readByte()) {");
      lines.push("    case 0:");
      lines.push("      return result;");
      lines.push("");
      indent = "      ";
    }
    for (let i = 0; i < definition.fields.length; i++) {
      let field = definition.fields[i];
      let code;
      let fieldType = field.type;
      if (aliases[fieldType]) fieldType = aliases[fieldType];
      switch (fieldType) {
        case "bool": {
          code = "!!bb.readByte()";
          break;
        }
        case "uint8":
        case "byte": {
          code = "bb.readByte()";
          break;
        }
        case "int16": {
          code = "bb.readInt16()";
          break;
        }
        case "alphanumeric": {
          code = "bb.readAlphanumeric()";
          break;
        }
        case "int8": {
          code = "bb.readInt8()";
          break;
        }
        case "int32": {
          code = "bb.readInt32()";
          break;
        }
        case "int": {
          code = "bb.readVarInt()";
          break;
        }
        case "uint16": {
          code = "bb.readUint16()";
          break;
        }
        case "uint32": {
          code = "bb.readUint32()";
          break;
        }
        case "lowp": {
          code = "bb.readLowPrecisionFloat()";
          break;
        }
        case "uint": {
          code = "bb.readVarUint()";
          break;
        }
        case "float": {
          code = "bb.readVarFloat()";
          break;
        }
        case "float32": {
          code = "bb.readFloat32()";
          break;
        }
        case "string": {
          code = "bb.readString()";
          break;
        }
        default: {
          let type = definitions[fieldType];
          if (!type) {
            error(
              "Invalid type " +
                quote(fieldType) +
                " for field " +
                quote(field.name),
              field.line,
              field.column
            );
          } else if (type.kind === "ENUM") {
            code = type.name + "[bb.readVarUint()]";
          } else if (type.kind === "SMOL") {
            code = type.name + "[bb.readByte()]";
          } else {
            code = "decode" + type.name + "(bb)";
          }
        }
      }
      if (definition.kind === "MESSAGE") {
        lines.push("    case " + field.value + ":");
      }
      if (field.isArray) {
        if (field.isDeprecated) {
          if (fieldType === "byte") {
            lines.push(indent + "bb.readByteArray();");
          } else {
            lines.push(indent + "var length = bb.readVarUint();");
            lines.push(indent + "while (length-- > 0) " + code + ";");
          }
        } else {
          switch (fieldType) {
            case "byte": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readByteArray();"
              );
              break;
            }
            case "uint16": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readUint16ByteArray();"
              );
              break;
            }
            case "uint32": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readUint32ByteArray();"
              );
              break;
            }
            case "int8": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readInt8ByteArray();"
              );
              break;
            }
            case "int16": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readInt16ByteArray();"
              );
              break;
            }
            case "int32": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readInt32ByteArray();"
              );
              break;
            }
            case "float32": {
              lines.push(
                indent +
                  "result[" +
                  quote(field.name) +
                  "] = bb.readFloat32ByteArray();"
              );
              break;
            }
            default: {
              lines.push(indent + "var length = bb.readVarUint();");
              lines.push(
                indent +
                  "var values = result[" +
                  quote(field.name) +
                  "] = Array(length);"
              );
              lines.push(
                indent +
                  "for (var i = 0; i < length; i++) values[i] = " +
                  code +
                  ";"
              );
              break;
            }
          }
        }
      } else if (fieldType && isDiscriminatedUnion(fieldType, definitions)) {
        lines.push(
          indent +
            "result[" +
            quote(field.name) +
            `] = ${"decode" + fieldType}(bb);`
        );
      } else if (
        fieldType &&
        definitions[fieldType] &&
        definitions[fieldType].kind === "UNION"
      ) {
        const key = quote(field.name + "Type");
        lines.push(
          indent + "result[" + key + "] = bb.readVarUint();",
          indent +
            "result[" +
            quote(field.name) +
            `] = ${"decode" + fieldType}(bb, result[${key}]);`
        );
      } else {
        if (field.isDeprecated) {
          lines.push(indent + code + ";");
        } else {
          lines.push(
            indent + "result[" + quote(field.name) + "] = " + code + ";"
          );
        }
      }
      if (definition.kind === "MESSAGE") {
        lines.push("      break;");
        lines.push("");
      }
    }
  }
  if (definition.kind === "MESSAGE") {
    lines.push("    default:");
    lines.push('      throw new Error("Attempted to parse invalid message");');
    lines.push("    }");
    lines.push("  }");
  } else if (definition.kind === "UNION") {
    lines.push("    default:");
    lines.push(`      throw new Error("Attempted to parse invalid union");`);
    lines.push("  }");
  } else {
    lines.push("  return result;");
  }
  lines.push("}");
  return lines.join("\n");
}
function compileEncode(functionName, definition, definitions, aliases) {
  let lines = [];
  if (definition.kind === "UNION") {
    const discriminator = definition.fields[0];
    const hasDiscriminator = discriminator.type === "discriminator";
    lines.push(`function ${functionName}(message, bb, type = 0) {`);
    if (hasDiscriminator) {
      lines.push(
        `  type = type ? type : ${definition.name}[message[${quote(
          discriminator.name
        )}]];`
      );
      lines.push(
        `  if (!type) throw new Error('Expected message[${quote(
          discriminator.name
        )}] to be one of ' + JSON.stringify(${definition.name}) + ' ');`
      );
    } else {
      lines.push(
        `  if (!type) throw new Error('Expected type to be one of ' + JSON.stringify(${definition.name}, null, 2) + ' ');`
      );
    }
    lines.push("");
    lines.push(`  bb.writeByte(type);`);
    lines.push("");
    lines.push(`  switch (type) {`);
    for (let j = hasDiscriminator ? 1 : 0; j < definition.fields.length; j++) {
      let field = definition.fields[j];
      let code;
      if (field.isDeprecated) {
        continue;
      }
      lines.push(`    case ${field.value}: {`);
      lines.push(`      ${"encode" + field.name}(message, bb)`);
      lines.push(`      break;`);
      lines.push(`    }`);
    }
    lines.push(`    default: {`);
    lines.push(
      `      throw new Error('Expected message[${quote(
        discriminator.name
      )}] to be one of ' + JSON.stringify(${definition.name}) + ' ');`
    );
    lines.push(`    }`);
    lines.push(`  }`);
    lines.push("");
    lines.push("}");
    return lines.join("\n");
  } else {
    lines.push(`function ${functionName}(message, bb) {`);
  }
  for (let j = 0; j < definition.fields.length; j++) {
    let field = definition.fields[j];
    let code;
    if (field.isDeprecated) {
      continue;
    }
    let fieldType = field.type;
    if (aliases[fieldType]) fieldType = aliases[fieldType];
    switch (fieldType) {
      case "bool": {
        code = "bb.writeByte(value);";
        break;
      }
      case "byte": {
        code = "bb.writeByte(value);";
        break;
      }
      case "alphanumeric": {
        code = "bb.writeAlphanumeric(value);";
        break;
      }
      case "int": {
        code = "bb.writeVarInt(value);";
        break;
      }
      case "int8": {
        code = "bb.writeInt8(value);";
        break;
      }
      case "int16": {
        code = "bb.writeInt16(value);";
        break;
      }
      case "int32": {
        code = "bb.writeInt32(value);";
        break;
      }
      case "uint": {
        code = "bb.writeVarUint(value);";
        break;
      }
      case "lowp": {
        code = "bb.writeLowPrecisionFloat(value);";
        break;
      }
      case "uint8": {
        code = "bb.writeByte(value);";
        break;
      }
      case "uint16": {
        code = "bb.writeUint16(value);";
        break;
      }
      case "uint32": {
        code = "bb.writeUint32(value);";
        break;
      }
      case "float": {
        code = "bb.writeVarFloat(value);";
        break;
      }
      case "float32": {
        code = "bb.writeFloat32(value);";
        break;
      }
      case "string": {
        code = "bb.writeString(value);";
        break;
      }
      case "discriminator": {
        code = `bb.writeVarUint(type);`;
        break;
      }
      default: {
        let type = definitions[fieldType];
        if (!type) {
          throw new Error(
            "Invalid type " +
              quote(fieldType) +
              " for field " +
              quote(field.name)
          );
        } else if (type.kind === "ENUM") {
          code =
            "var encoded = " +
            type.name +
            '[value];\nif (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' +
            quote(" for enum " + quote(type.name)) +
            ");\nbb.writeVarUint(encoded);";
        } else if (type.kind === "SMOL") {
          code =
            "var encoded = " +
            type.name +
            '[value];\nif (encoded === void 0) throw new Error("Invalid value " + JSON.stringify(value) + ' +
            quote(" for enum " + quote(type.name)) +
            ");\nbb.writeByte(encoded);";
        } else if (
          type.kind === "UNION" &&
          isDiscriminatedUnion(type.name, definitions)
        ) {
          code = "" + ("encode" + type.name) + "(value, bb);";
        } else if (type.kind === "UNION") {
          code =
            "var encoded = " +
            type.name +
            `[message[${quote(field.name + "Type")}]];
    if (encoded === void 0) throw new Error('Expected ${quote(
      field.name + "Type"
    )} to be one of ' + JSON.stringify(${
              type.name
            },null,2) + ' for enum ${quote(type.name)}');`;
          code += "" + ("encode" + type.name) + "(value, bb, encoded);";
        } else {
          code = "" + ("encode" + type.name) + "(value, bb);";
        }
      }
    }
    lines.push("");
    if (fieldType === "discriminator") {
      error("Unexpected discriminator", field.line, field.column);
    } else {
      lines.push("  var value = message[" + quote(field.name) + "];");
      lines.push("  if (value != null) {");
    }
    if (definition.kind === "MESSAGE") {
      lines.push("    bb.writeByte(" + field.value + ");");
    }
    if (field.isArray) {
      let indent = "   ";
      switch (fieldType) {
        case "byte": {
          lines.push(indent + "bb.writeByteArray(value);");
          break;
        }
        case "uint16": {
          lines.push(indent + "bb.writeUint16ByteArray(value);");
          break;
        }
        case "uint32": {
          lines.push(indent + "bb.writeUint32ByteArray(value);");
          break;
        }
        case "int8": {
          lines.push(indent + "bb.writeInt8ByteArray(value);");
          break;
        }
        case "int16": {
          lines.push(indent + "bb.writeInt16ByteArray(value);");
          break;
        }
        case "int32": {
          lines.push(indent + "bb.writeInt32ByteArray(value);");
          break;
        }
        case "float32": {
          lines.push(indent + "bb.writeFloat32ByteArray(value);");
          break;
        }
        default: {
          lines.push("    var values = value, n = values.length;");
          lines.push("    bb.writeVarUint(n);");
          lines.push("    for (var i = 0; i < n; i++) {");
          lines.push("      value = values[i];");
          lines.push("      " + code);
          lines.push("    }");
        }
      }
    } else {
      lines.push("    " + code);
    }
    if (definition.kind === "STRUCT") {
      lines.push("  } else {");
      lines.push(
        "    throw new Error(" +
          quote("Missing required field " + quote(field.name)) +
          ");"
      );
    }
    lines.push("  }");
  }
  if (definition.kind === "MESSAGE") {
    lines.push("  bb.writeByte(0);");
  }
  lines.push("");
  lines.push("}");
  return lines.join("\n");
}
function compileSchemaJS(schema, isESM = false, withAllocator = false) {
  let definitions = {};
  let aliases = {};
  let name = schema.package;
  let js = [];
  const exportsList = [];
  const importsList = [];
  if (isESM) {
    name = "exports";
  } else {
    if (name !== null) {
      js.push("var " + name + " = exports || " + name + " || {}, exports;");
    } else {
      js.push("var exports = exports || {};");
      name = "exports";
    }
  }
  for (let i = 0; i < schema.definitions.length; i++) {
    let definition = schema.definitions[i];
    definitions[definition.name] = definition;
    if (definition.kind === "ALIAS") {
      aliases[definition.name] = definition.fields[0].name;
    }
    if (isESM && definition.serializerPath?.length) {
      importsList.push(
        `import {encode${definition.name}, decode${definition.name}} from "${definition.serializerPath}";`
      );
    }
  }
  for (let i = 0; i < schema.definitions.length; i++) {
    let definition = schema.definitions[i];
    if (definition.kind === "ALIAS") continue;
    switch (definition.kind) {
      case "SMOL":
      case "ENUM": {
        let value = {};
        let keys = {};
        for (let j = 0; j < definition.fields.length; j++) {
          let field = definition.fields[j];
          value[field.name] = field.value;
          value[field.value] = field.value;
          keys[field.name] = field.name;
          keys[field.value] = field.name;
        }
        exportsList.push(definition.name, definition.name + "Keys");
        js.push(
          "const " +
            definition.name +
            " = " +
            JSON.stringify(value, null, 2) +
            ";"
        );
        js.push(
          "const " +
            definition.name +
            "Keys = " +
            JSON.stringify(keys, null, 2) +
            ";"
        );
        break;
      }
      case "UNION": {
        let value = {};
        let keys = {};
        const encoders = new Array(definition.fields.length);
        encoders.fill("() => null");
        for (let j = 0; j < definition.fields.length; j++) {
          let field = definition.fields[j];
          let fieldType = field.type;
          if (field.value > 0) {
            if (aliases[field.name]) field.name = aliases[field.name];
            value[field.name] = field.value;
            value[field.value] = field.value;
            keys[field.name] = field.name;
            keys[field.value] = field.name;
            encoders[field.value] = "encode" + fieldType;
          }
        }
        exportsList.push(definition.name);
        js.push(
          "const " +
            definition.name +
            " = " +
            JSON.stringify(value, null, 2) +
            ";"
        );
        js.push(
          "const " +
            definition.name +
            "Keys = " +
            JSON.stringify(keys, null, 2) +
            ";"
        );
        exportsList.push(`${definition.name}Keys`);
        js.push("const " + definition.name + "Type = " + definition.name + ";");
        exportsList.push(definition.name + "Type");
        const encoderName = encoders.join(" , ");
        js.push(
          "const encode" +
            definition.name +
            "ByType = (function() { return [" +
            encoderName +
            "]; })()"
        );
      }
      case "STRUCT":
      case "MESSAGE": {
        exportsList.push(
          "decode" + definition.name,
          "encode" + definition.name
        );
        if (!isESM || !definition.serializerPath?.length) {
          js.push("");
          js.push(
            compileDecode(
              "decode" + definition.name,
              definition,
              definitions,
              withAllocator,
              aliases
            )
          );
          js.push("");
          js.push(
            compileEncode(
              "encode" + definition.name,
              definition,
              definitions,
              aliases
            )
          );
        }
        break;
      }
      default: {
        error(
          "Invalid definition kind " + quote(definition.kind),
          definition.line,
          definition.column
        );
        break;
      }
    }
  }
  js.push("");
  if (isESM) {
    for (let importName of importsList) {
      js.unshift(importName);
    }
    for (let exportName of exportsList) {
      js.push(`export { ${exportName} }`);
    }
  } else {
    for (let exportName of exportsList) {
      js.push(`exports[${quote(exportName)}] = ${exportName};`);
    }
  }
  return js.join("\n");
}
function compileSchema(schema, useESM = false, Allocator) {
  let result = Allocator
    ? {
        Allocator,
        ByteBuffer,
      }
    : { ByteBuffer };
  if (typeof schema === "string") {
    schema = parseSchema(schema);
  }
  let out = compileSchemaJS(schema, useESM, !!Allocator);
  if (useESM) {
    if (Allocator) {
      out = `import * as Allocator from "${Allocator}";

${out}`;
    }
    return out;
  } else {
    new Function("exports", out)(result);
    return result;
  }
}
export { ByteBuffer, compileSchema, decodeBinarySchema };
