import { td } from "../text-decoder";

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

  string(byteLength: number) {
    const str = td.decode(this.view.buffer.slice(this.cursor, this.cursor + byteLength));
    this.cursor += byteLength;
    return str;
  }
}
