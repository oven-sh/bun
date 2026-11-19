let o = "";
for (const s of ["http://a/1", "http://a/2"]) { o += new URL(...[s]).pathname;
o += ".";
} console.log(o);
export {};
