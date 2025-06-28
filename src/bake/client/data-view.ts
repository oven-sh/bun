import { td, te } from "../shared";

export class DataViewReader {
  view: DataView;
  cursor: number;

  constructor(view: DataView, cursor: number = 0) {
    this.view = view;
    this.cursor = cursor;
  }

  u32() {
    const value = this.view.getUint32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  i32() {
    const value = this.view.getInt32(this.cursor, true);
    this.cursor += 4;
    return value;
  }

  u16() {
    const value = this.view.getUint16(this.cursor, true);
    this.cursor += 2;
    return value;
  }

  u8() {
    const value = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return value;
  }

  stringWithLength(byteLength: number) {
    const str = td.decode(this.view.buffer.slice(this.cursor, this.cursor + byteLength) as ArrayBuffer);
    this.cursor += byteLength;
    return str;
  }

  string32() {
    return this.stringWithLength(this.u32());
  }

  hasMoreData() {
    return this.cursor < this.view.byteLength;
  }

  rest() {
    return this.view.buffer.slice(this.cursor);
  }
}

export class DataViewWriter {
  view: DataView<ArrayBuffer>;
  uint8ArrayView: Uint8Array;
  cursor: number;
  capacity: number;

  static initCapacity(capacity: number) {
    const view = new DataView(new ArrayBuffer(capacity));
    return new DataViewWriter(view, 0, capacity);
  }

  constructor(view: DataView<ArrayBuffer>, cursor: number, capacity: number) {
    this.view = view;
    this.cursor = cursor;
    this.capacity = capacity;
    this.uint8ArrayView = new Uint8Array(view.buffer);
  }

  u8(value: number) {
    this.view.setUint8(this.cursor, value);
    this.cursor += 1;
  }

  u32(value: number) {
    this.view.setUint32(this.cursor, value, true);
    this.cursor += 4;
  }

  i32(value: number) {
    this.view.setInt32(this.cursor, value, true);
    this.cursor += 4;
  }

  string(value: string) {
    if (value.length === 0) return;
    const encodeResult = te.encodeInto(value, this.uint8ArrayView.subarray(this.cursor));
    if (encodeResult.read !== value.length) {
      throw new Error("Failed to encode string");
    }
    this.cursor += encodeResult.written;
  }

  stringWithLength(value: string) {
    const cursor = this.cursor;
    this.u32(0);
    this.string(value);
    this.view.setUint32(cursor, this.cursor - cursor - 4, true);
  }
}
