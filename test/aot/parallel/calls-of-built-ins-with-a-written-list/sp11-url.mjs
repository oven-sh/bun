const s = JSON.parse('"http://a/b?c=1"');
console.log(new URL(...[s]).pathname, new URL(...["/x", s]).href, URL.canParse(...[s]));
export {};
