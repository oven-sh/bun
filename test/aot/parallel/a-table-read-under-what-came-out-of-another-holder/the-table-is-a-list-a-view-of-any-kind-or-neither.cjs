"use strict";
// `h = (h >>> 8) ^ table[(h ^ bytes[i]) & 255]`: the table is read under what came out of the other holder. Beside bytes it is expected to be a view of any kind first, then a list; whatever it is, the answer is plain's.
var key = JSON.parse('"go"'), lines = [];
var crc = { go(d, table) { var h = 0; for (var i = 0; i < d.length; i++) h = (h >>> 8) ^ table[(h ^ d[i]) & 255]; return h; } };
var mapped = { go(d, table) { var s = 0; for (var i = 0; i < d.length; i++) s += table[d[i]] * 2; return s; } };
var twoTables = { go(d, low, high) { var s = 0; for (var i = 0; i < d.length; i++) s = (s + low[d[i] & 15] * high[d[i] >> 4]) | 0; return s; } };
var fill = (made) => { for (var k = 0; k < made.length; k++) made[k] = (k * 2654435761) % 1000 - 300 + (k & 1) / 2; return made; };
var data = [new Uint8Array(37).map((x, k) => k * 7), Buffer.from("the quick brown fox"), new Uint8ClampedArray(9).fill(200), new Int8Array([1, 2, 3, 100]), new Uint16Array([1, 255, 256, 65535]), new Float64Array([1, 2.5, 3, NaN]), [1, 2, 3, 250], new Uint8Array(0)];
class Table extends Int32Array {}
var record = {}; for (var k = 0; k < 256; k++) record[k] = k * 3 - 100;
var tables = [fill(new Int32Array(256)), fill(new Uint32Array(256)), fill(new Int16Array(256)), fill(new Uint16Array(256)), fill(new Int8Array(256)), fill(new Uint8Array(256)), fill(new Uint8ClampedArray(256)), fill(new Float32Array(256)), fill(new Float64Array(256)), fill(new Table(256)), fill(Buffer.alloc(256)), fill(new Array(256).fill(0)), Array.from({ length: 256 }, (x, k) => k), Array.from({ length: 256 }, (x, k) => String(k)), record, "x".repeat(256), new Int32Array(100).fill(5), [1, 2, 3], new BigInt64Array(0)];
for (var table of tables) { var said = []; for (var d of data) said.push(crc[key](d, table), mapped[key](d, table)); lines.push((table.constructor ? table.constructor.name : "?") + " " + table.length + ": " + said.join()); }
try { crc[key](data[0], new BigInt64Array(256)); } catch (error) { lines.push(error.name + ": " + error.message); }
lines.push(twoTables[key](data[0], fill(new Int16Array(16)), fill(new Float32Array(16))), twoTables[key](data[0], fill(new Int16Array(16)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), twoTables[key](data[0], data[0], data[0]));
console.log(lines.join("\n"));
