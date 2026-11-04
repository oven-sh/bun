function outer(c: boolean): string { var held: string | undefined; if (c) held = "set"; return read(); function read(): string { return String(held); } }
console.log(outer(true), outer(false));
