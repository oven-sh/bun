// A substring of an 8-bit string whose characters were replaced by those of an equal 16-bit interned string is compared with an equal literal.
const table: Record<string, number> = {};
const wide = "qwertyuiopasdfghjkl☃".slice(0, 19);
Symbol(wide);
table[wide] = 1;
const narrow = "QWERTYUIOPASDFGHJKL".toLowerCase();
const six = narrow.slice(2, 8), three = narrow.slice(2, 5), eight = narrow.slice(2, 10), thirteen = narrow.slice(2, 15);
console.log(table[narrow], "(1: the base is a key of the table: it takes the atom's characters, which are 16 bits wide)");
function equalsShort(s: string) { return s === "ertyui"; }
function equalsThree(s: string) { return s === "ert"; }
function equalsEight(s: string) { return s === "ertyuiop"; }
function equalsLong(s: string) { return s === "ertyuiopasdfg"; }
console.log(equalsShort(six), equalsThree(three), equalsEight(eight), equalsLong(thirteen), "(true true true true)");
console.log(six.length, six.charCodeAt(0), six + "!", "(6 101 ertyui!)");
