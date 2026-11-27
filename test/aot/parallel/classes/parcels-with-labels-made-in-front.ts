// A class that a function makes has a field whose value is made, a function, a list, a Map or an object, in front of a private one. A helper hands a parcel back, and a body whose parameters are of any kind allocates it.
const depot: any = (function () {
    class Parcel {
        describe: any = () => "a parcel";
        #weight: number = 1;
        mark: number;
        constructor(mark: number, extra: number) { this.mark = mark + extra; }
        weigh(): number { return this.#weight; }
    }
    function pack(mark: number, extra: number): Parcel { return new Parcel(mark, extra); }
    class Crate {
        stops: any[] = [];
        #lid = null as any;
        #weight = 2;
        mark: any;
        constructor(mark: any, extra: any) { this.mark = mark; }
        weigh(): any { return [this.#weight, this.#lid, this.stops.length]; }
    }
    function crate(mark: any, extra: any): any { mark = mark | 0; return new Crate(mark, extra); }
    class Sack {
        counts: any = new Map();
        #weight: any = 3;
        first: any = { at: 0 };
        #second: any = "s";
        mark: any;
        constructor(mark: any, extra: any) { this.mark = mark; }
        weigh(): any { return [this.#weight, this.#second, this.counts.size, this.first.at]; }
    }
    function sack(mark: any, extra: any): any { return new Sack(mark, extra); }
    return {
        sum(count: number): number { let sum = 0; for (let place = 0; place < count; place++) { const parcel = pack(place, place & 3); sum += parcel.mark ? 1 : 2; } return sum; },
        kept(count: number): any { const parcels: any[] = []; for (let place = 0; place < count; place++) { const parcel = pack(place, place & 1); if (parcel.mark > 2) parcels.push(parcel); } return parcels.map(parcel => [parcel.mark, parcel.weigh(), parcel.describe(), Object.keys(parcel).join()]); },
        crates(count: number): any { const last: any[] = []; let sum = 0; for (let place = 0; place < count; place++) { const one = crate(place, place & 3); sum += one.mark * 2; sum += one.mark; if (place === count - 1) last.push(one); } return [sum, last.map(one => [one.weigh(), Object.keys(one).join(), one.stops])]; },
        sacks(count: number): any { let last: any = null, sum = 0; for (let place = 0; place < count; place++) { const one = sack(place, 0); sum += typeof one.mark === "number" ? one.mark : 1; if (place & 1) last = one; } return [sum, last && [last.weigh(), Object.keys(last).join()]]; },
    };
})();
const held: any = JSON.parse("{}");
held["depot" + process.pid] = depot;
for (const count of [5, 1, 0, 20, "20", 3.5, "4"] as any[]) {
    const here = held["depot" + process.pid];
    console.log(JSON.stringify([here.sum(count), here.kept(count), here.crates(count), here.sacks(count)]));
}
export {};
