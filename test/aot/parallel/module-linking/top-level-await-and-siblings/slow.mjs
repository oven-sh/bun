globalThis.log ??= []; const note = s => globalThis.log.push(s); note("slow starts"); await new Promise(r => setTimeout(r, 20)); note("slow ends"); export const s = 1;
