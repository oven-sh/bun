function look(view: DataView, at: number): string { let read: unknown; try { read = view.getInt8(at); } catch (error) { read = (error as Error).name; } let length: unknown; try { length = view.byteLength; } catch (error) { length = (error as Error).name; } return read + ":" + length; }
const buffer = new ArrayBuffer(JSON.parse("8"), { maxByteLength: 32 }), follows = new DataView(buffer), part = new DataView(buffer, 2, 4), plain = new DataView(new ArrayBuffer(8));
follows.setInt8(7, 3); part.setInt8(3, 4); plain.setInt8(7, 5);
let said = ""; for (const size of [8, 16, 4, 2, 32]) { buffer.resize(size); said += look(follows, 7) + " " + look(part, 3) + " " + look(plain, 7) + " | "; }
console.log("SAID " + said);
