// the method has stored one field of this and not yet the other; the slow version stores the other, and this is the same object
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Rate { percent: number; constructor(percent: number) { this.percent = percent; } }
class Account {
    balance = 100;
    history: string[] = [];
    moves = 0;
    apply(rate: Rate, times: number): Account {
        this.moves += 1;
        this.history.push("apply " + times);
        const gain = this.balance * rate.percent / 100;
        this.balance += gain * times;
        this.history.push("gain " + gain);
        return this;
    }
}
const applyByValue = through((account: Account, rate: Rate, times: number) => account.apply(rate, times) === account);
const account = new Account();
console.log(applyByValue(account, new Rate(10), 1), applyByValue(account, { percent: 50 } as any, 2), applyByValue(account, new Rate(1), 3), account.balance, account.moves, account.history.join());
// The same through a name that nobody knows at build time: the method is entered at its own body.
const methodNames = JSON.parse('["apply"]');
const other: any = new Account();
console.log(other[methodNames[0]](new Rate(10), 1) === other, other[methodNames[0]]({ percent: 50 }, 2) === other, other[methodNames[0]](new Rate(1), 3) === other, other.balance, other.moves, other.history.join());
