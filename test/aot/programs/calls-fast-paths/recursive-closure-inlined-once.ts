// A closure that calls itself, handed to a function that calls it: its body is taken in once; the call of itself in that copy stays a call.
// IR= 1 total PropGet v\d+ name="value"(?!.* isFallback)
// IR= 1 total CallDirect
declare const console: any;
type Link = { value: number; next: Link | null };

function each(links: Link[], visit: (link: Link) => void): void {
    for (let i = 0; i < links.length; i++) visit(links[i]);
}

function total(links: Link[]): number {
    let sum = 0;
    function visit(link: Link): void {
        sum += link.value;
        if (link.next !== null) visit(link.next);
    }
    for (let round = 0; round < 3; round++) each(links, visit);
    return sum;
}

console.log(total([{ value: 1, next: { value: 2, next: { value: 3, next: null } } }, { value: 4, next: null }]));
export {};
