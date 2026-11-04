// no parameter is at fault, so no test at the entry sees it: the field holds a literal in the place of the written class, and one field of this is stored already
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Rate { percent: number; constructor(percent: number) { this.percent = percent; } }
class Account {
    balance = 100;
    history: string[] = [];
    moves = 0;
    rate: Rate;
    constructor(rate: Rate) { this.rate = rate; }
    apply(times: number): Account {
        this.moves += 1;
        this.history.push("apply " + times);
        const rate = this.rate;
        const gain = this.balance * rate.percent / 100;
        this.balance += gain * times;
        this.history.push("gain " + gain);
        return this;
    }
}
const methodNames = JSON.parse('["apply"]');
for (const rate of [new Rate(10), { percent: 50 }, { get percent() { return 1; } }] as any[]) {
    const account: any = new Account(rate);
    console.log(account[methodNames[0]](1) === account, account[methodNames[0]](2) === account, account.balance, account.moves, account.history.join());
}
