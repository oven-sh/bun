// `[undefined, undefined]` keeps two places free; each call makes a list of its own and stores into it.
type Frame = { depth: number; stack: (string | undefined)[] };
function enter(depth: number): Frame {
    return { depth, stack: [undefined, undefined] };
}
function fill(frame: Frame, at: number, text: string) {
    frame.stack[at] = text;
}
const frames: Frame[] = [];
for (let i = 0; i < 2000; i++) {
    const frame = enter(i);
    fill(frame, i & 1, "t" + i);
    if (i % 3 === 0) fill(frame, 2, "more" + i);
    frames.push(frame);
}
let lengths = 0, filled = 0;
for (const frame of frames) {
    lengths += frame.stack.length;
    for (const text of frame.stack) filled += text === undefined ? 0 : text.length;
}
console.log(lengths, filled, JSON.stringify(frames[0].stack), JSON.stringify(frames[1].stack), JSON.stringify(frames[1999].stack));
