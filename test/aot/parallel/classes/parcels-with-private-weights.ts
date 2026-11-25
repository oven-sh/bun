// A class that a function makes has a private field. A helper hands a parcel back, and a body whose parameters are of any kind asks for its mark.
const depot: any = (function () {
    class Parcel {
        mark: any;
        #weight: any = 1;
        constructor(mark: any, label: any) { this.mark = mark; }
        static isParcel(value: any) { return #weight in value; }
        weigh(): any { return this.#weight; }
    }
    function pack(mark: any, label: any): any { return new Parcel(mark, 2); }
    return {
        run(count: number, other: any): any {
            let sum: any = 0;
            for (let place = 0; place < count; place++) {
                const parcel: any = pack(place, place & 3);
                sum += typeof parcel.mark === "number" ? parcel.mark : 1;
            }
            return sum;
        },
        kept(count: number): any {
            const parcels: any[] = [];
            for (let place = 0; place < count; place++) {
                const parcel: any = pack(place, 0);
                if (parcel.mark > 2)
                    parcels.push(parcel);
            }
            return parcels.map(parcel => [parcel.mark, parcel.weigh(), Parcel.isParcel(parcel), Object.keys(parcel).join()]);
        },
    };
})();

const office: any = (function () {
    class Tray {
        mark: number;
        #height = 3;
        constructor(mark: number, label: number) { this.mark = mark; }
        get height(): number { return this.#height; }
    }
    function tray(mark: number, label: number): Tray { return new Tray(mark, 2); }
    return {
        run(count: number, other: any): number {
            let sum = 0;
            let last: any;
            for (let place = 0; place < count; place++) {
                const one = tray(place, place & 3);
                sum += one.mark;
                last = one;
            }
            return sum + (last ? last.height : 0);
        },
    };
})();

function ask(count: any): any { return [depot.run(count, 0), depot.kept(count), office.run(count, 0)]; }
const held: any = JSON.parse("{}");
held["ask" + process.pid] = ask;
for (const count of [5, 1, 20, 0, 3.5, "4"])
    console.log(JSON.stringify(held["ask" + process.pid](count)));
export {};
