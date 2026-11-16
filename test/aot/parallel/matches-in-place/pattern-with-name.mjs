const all = ['x1y2', 'a-1 b-2', '', 'ba', 'abc'];
class K { re = /(\d+)(?:-(\d+))?(-z)?/; one(string) { let s = ''; const array = this.re.exec(string); if (array) { for (let j = 0; j < array.length; j++) { const part = array[j]; if (part) s += part; } } return s; } all(list) { let n = ''; for (let i = 0; i < list.length; i++) n += this.one(list[i]); return n; } }
const k = new K(); console.log(k.all(all), k.all(all)); k.re.name = 'x'; console.log(k.all(all));
