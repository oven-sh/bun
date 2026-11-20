// a loop over list.entries(): a length that was raised: a field is read
interface Account { balance: number }
function make(i: number): Account { return { balance: i }; }
let grows: Account[] | undefined;
let kinds = "";
function total(accounts: Account[]): number { let sum = 0; for (const [i, account] of accounts.entries()) { sum += account.balance; if (grows && grows.length < 6) grows.push(make(grows.length * 10)); sum += i; } return sum; }
const list: Account[] = [make(1), make(2)]; list.length = 4;
function tell(): string { try { return String(total(list)) + " " + kinds; } catch (error) { return "thrown: " + (error as Error).constructor.name + " " + kinds; } }
console.log(tell()); kinds = ""; console.log(tell()); console.log(list.length);
