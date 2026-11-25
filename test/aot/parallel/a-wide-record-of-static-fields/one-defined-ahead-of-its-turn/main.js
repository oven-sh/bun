const plain = value => ({ value, writable: true, enumerable: true, configurable: true });
class Wide {
  static a = 1; static b = 2; static c = (Object.defineProperty(Wide, "k", plain("early")), 3); static d = 4; static e = 5; static f = 6;
  static g = 7; static h = 8; static i = 9; static j = 10; static k = 11; static l = 12; static m = 13;
}
console.log(Wide.k, Wide.c, Wide.m, Object.keys(Wide).join());
