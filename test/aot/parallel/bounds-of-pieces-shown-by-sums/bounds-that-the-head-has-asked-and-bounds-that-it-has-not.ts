function sumOf(piece: string): number { let s = piece.length * 131; for (let i = 0; i < piece.length; i++) s = (s * 31 + piece.charCodeAt(i)) | 0; return s; }
function head(text: string, w: number): number { let s = 0; for (let i = 0; i < text.length - w + 1; i++) s = (s + sumOf(text.substring(i, i + w))) | 0; return s; }
function cutBySlice(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) s = (s + sumOf(text.slice(i, i + w))) | 0; return s; }
function counted(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) s = (s + sumOf(text.substr(i, w))) | 0; return s; }
function more(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) s = (s + sumOf(text.substring(i, i + w + 1))) | 0; return s; }
function bump(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) { i++; s = (s + sumOf(text.substring(i, i + w))) | 0; } return s; }
function grow(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) { if ((i & 3) === 3) w++; s = (s + sumOf(text.substring(i, i + w))) | 0; } return s; }
function shrink(text: string, w: number): number { let s = 0; for (let i = 0; i <= text.length - w; i++) { if ((i & 3) === 3) text = text.substring(0, text.length - 1); s = (s + sumOf(text.substring(i, i + w))) | 0; } return s; }
function outside(text: string, end: number): number { let s = 0; for (let i = 0; i < 2; i++) s = (s + i) | 0; if (end <= text.length) return s; return (s + sumOf(text.substring(0, end))) | 0; }
function run(rows: any[]): void {
  for (const row of rows) {
    const text = String(row[0]), w = row[1] >>> 0;
    console.log("SAID", w, head(text, w), cutBySlice(text, w), counted(text, w), more(text, w), bump(text, w), grow(text, w), shrink(text, w), outside(text, w));
  }
}
run(JSON.parse('[["abcdefghij",0],["abcdefghij",1],["abcdefghij",3],["abcdefghij",10],["abcdefghij",11],["abcdefghij",4294967295],["",0],["",1],["\\u4e00bcdefghi\\u00ff",4]]'));
