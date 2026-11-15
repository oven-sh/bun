const X = JSON.parse(`["待機中の接続ですよねえ", "開いた接続ですよねええ", "忙しい接続ですよねええ", "閉じた接続ですよねええ"]`);
const C = new Map([["待機中の接続ですよねえ", 1], ["開いた接続ですよねええ", 2], ["忙しい接続ですよねええ", 3], ["閉じた接続ですよねええ", 4]]);
function f(t) { let r = t & 1; for (let i = 0; i < 64; i++) { r += C.get(X[i & 3]); } return r; }
const n = Number(process.argv[2] ?? "50"); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
