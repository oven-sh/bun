function tables(n: number): string { let name = ""; let all = 0; for (let k = 0; k < n; k++) { name = name + "x"; const row: string[] = []; for (let i = 0; i < n; i++) row[i] = name + i; all += row.length; } return name + all; }
const n: number = JSON.parse("5"); console.log(tables(n));
export {};
