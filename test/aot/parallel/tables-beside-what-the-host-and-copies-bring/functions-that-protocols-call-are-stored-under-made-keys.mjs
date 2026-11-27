const names = ['JSON', 'String'];
const table = { a: 1 };
for (let i = 0; i < 2; i++) table['to' + names[i]] = i ? () => 'text' : () => ({ made: 2 });
console.log('SAID ' + [JSON.stringify(table), JSON.stringify([table]), `${table}`, String(table), table + ''].join('|'));
