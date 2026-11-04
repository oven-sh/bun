// the captured names are read in front of the point and behind it; two closures of the one function hold different values
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Item { size: number; constructor(size: number) { this.size = size; } }
const log: string[] = [];
function make(base: number, tag: string, shared: { count: number }) {
    return (item: Item, times: number): string => {
        log.push(tag);
        shared.count += base;
        const size = item.size;
        return tag + (size * times + base) + "/" + shared.count;
    };
}
const shared = { count: 0 };
const first = through(make(1, "a", shared));
const second = through(make(100, "b", shared));
for (const item of [new Item(2), { size: 3 }, new Item(4), { get size() { shared.count = -1; return 5; } }] as any[]) console.log(first(item, 10), second(item, 20));
console.log(log.join(""), shared.count);
