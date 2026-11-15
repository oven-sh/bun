// answers: without-library
// # The key of an access that stays closed comes out of arithmetic: a number, perhaps with a fraction. Off a value that is expected to be an Int32Array or a Uint8Array the call still names what it expects:
// # the stub asks whether the key is an int32 before anything else, and goes on to the stub that takes everything where it is none. The access does not claim that its key is integral: no flag stands behind the word.
// # f1 = put, f2 = get, f3 = byte
// # RUN(PUT): walk f1 mechanisms=all
// # PUT: = ElemSet {{*}}expectedElements=Int32Array traits=
// # RUN(GET): walk f2 mechanisms=all
// # GET: = ElemGet {{*}}expectedElements=Int32Array traits=
// # RUN(BYTE): walk f3 mechanisms=all
// # BYTE: = ElemGet {{*}}expectedElements=Uint8Array traits=
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 37 of 37 of 37
// # CHECK-NEXT: exited with 0
type Holder = { words: Int32Array; bytes: Uint8Array };
function put(holder: Holder, a: number, b: number, value: number): void { holder.words[+a * +b] = value; }
function get(holder: Holder, a: number, b: number): number { return holder.words[+a * +b]; }
function byte(holder: Holder, a: number, b: number): number { return holder.bytes[+a % +b]; }
const made: Holder[] = [{ words: new Int32Array(4), bytes: new Uint8Array(4) }, { words: new Int32Array(1), bytes: new Uint8Array(1) }];
const strange = [{ words: [1, 2, 3], bytes: "text" }];
const all = (made as unknown[]).concat(strange) as Holder[];
const pairs = [[1, 2], [0.5, 2], [0.5, 3], [3, 0], [-1, 1], [65536, 65536]];
for (let at = 0; at < all.length; at++) for (let p = 0; p < pairs.length; p++) { put(all[at], pairs[p][0], pairs[p][1], 7 + p); report(get(all[at], pairs[p][0], pairs[p][1])); report(byte(all[at], pairs[p][0], pairs[p][1])); }
report("end");
declare function report(value: unknown): void;
