class Base { name() { return "base"; } size() { return 1; } }
class Middle extends Base { name() { return "middle"; } }
class Leaf extends Middle { size() { return 3; } leaf() { return true; } }
class Apart { name() { return "apart"; } }
const all = [new Base(), new Middle(), new Leaf(), new Apart()];
for (const it of all) console.log(`SAID ${it.name()} ${it instanceof Base ? it.size() : "-"}`);
