// answers: without-library
// # One access at a written index off a field that is only written to hold an Int32Array or a Uint8Array opens no guess outside of loops: it stays a call of five bytes.
// # The call names what is expected: the stub asks for that kind of view first, and goes on to the stub that takes everything where something else has arrived.
// # A Float64Array has no such stub: the access expects nothing.
// # f1 = put, f2 = get, f3 = byte, f4 = wide
// # RUN(PUT): walk f1 mechanisms=all
// # PUT: = ElemSet {{*}}expectedElements=Int32Array
// # RUN(GET): walk f2 mechanisms=all
// # GET: = ElemGet {{*}}expectedElements=Int32Array
// # RUN(BYTE): walk f3 mechanisms=all
// # BYTE: = ElemGet {{*}}expectedElements=Uint8Array
// # RUN(WIDE): walk f4 mechanisms=all
// # WIDE-NOT: expectedElements
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
type Holder = { words: Int32Array; bytes: Uint8Array; wide: Float64Array };
function put(holder: Holder, value: number): void { holder.words[1] = value; }
function get(holder: Holder): number { return holder.words[1]; }
function byte(holder: Holder): number { return holder.bytes[2]; }
function wide(holder: Holder): number { return holder.wide[0]; }
const made: Holder[] = [{ words: new Int32Array(3), bytes: new Uint8Array(3), wide: new Float64Array(3) }, { words: new Int32Array(1), bytes: new Uint8Array(1), wide: new Float64Array(1) }];
const strange = [{ words: [1, 2, 3], bytes: "text", wide: { 0: "zero" } }];
const all = (made as unknown[]).concat(strange) as Holder[];
for (let round = 0; round < 2; round++) for (let at = 0; at < all.length; at++) { put(all[at], 7 + round); report(get(all[at])); report(byte(all[at])); report(wide(all[at])); }
report("end");
