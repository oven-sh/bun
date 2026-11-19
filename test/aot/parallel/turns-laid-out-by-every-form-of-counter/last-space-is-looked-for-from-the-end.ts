function run(s: string): number { for (let i = s.length - 1; i >= 0; i--) { if (s.charCodeAt(i) === 32) return i; } return -1; }
function once(length: number, at: number, filler: string): number { let text = ""; for (let i = 0; i < length; i++) text += i === at ? " " : filler; return run(text); }
for (let length = 0; length < 30; length++) { let said = ""; for (let at = -1; at <= length; at++) said += once(length, at, "a") + "," + once(length, at, "\u03a9") + " "; console.log(length, said); }
