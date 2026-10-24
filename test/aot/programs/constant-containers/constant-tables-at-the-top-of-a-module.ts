const codes = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 410, 418, 422, 429, 500, 501, 502, 503, 504];
const names = ["OK", "Created", "No Content", "Moved Permanently", "Found", "Not Modified", "Bad Request", "Unauthorized", "Forbidden", "Not Found", "Method Not Allowed", "Conflict", "Gone", "I'm a teapot", "Unprocessable Entity", "Too Many Requests", "Internal Server Error", "Not Implemented", "Bad Gateway", "Service Unavailable", "Gateway Timeout"];
const weights = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9];
const matrix = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [2, 2, 2, 2]];
const colors = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255], black: [0, 0, 0], gray: [128, 128, 128] } as Record<string, number[]>;
const table = [{ code: 200, text: "OK", retry: false }, { code: 404, text: "Not Found", retry: false }, { code: 429, text: "Too Many Requests", retry: true }, { code: 500, text: "Internal Server Error", retry: true }, { code: 503, text: "Service Unavailable", retry: true }, { code: 504, text: "Gateway Timeout", retry: true }];
export const exported = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const small = [1, 2, 3], pair = [0.5, 1.5];
function lookup(code: number): string { const i = codes.indexOf(code); return i < 0 ? "?" : names[i]; }
let sum = 0; for (let i = 0; i < codes.length; i++) sum += codes[i]; for (const w of weights) sum += w; for (const row of matrix) for (const v of row) sum += v;
console.log(lookup(404), lookup(418), lookup(1), sum.toFixed(2), colors.gray.join(), table.filter(r => r.retry).map(r => r.text).join(), small.length + pair.length);
matrix[1][1] = 5; matrix[4].push(9); colors.red[0] = 1; codes.push(599); names.sort(); weights.reverse(); table[0].code = 1; exported[0] = -1; small[1] = 20; pair.pop();
console.log(JSON.stringify([matrix, colors, codes, names.slice(0, 3), weights.slice(0, 2), table[0], exported, small, pair]));
