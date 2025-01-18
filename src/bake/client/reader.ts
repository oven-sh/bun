import { td } from "../shared";

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
    const str = td.decode(this.view.buffer.slice(this.cursor, this.cursor + byteLength));
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
