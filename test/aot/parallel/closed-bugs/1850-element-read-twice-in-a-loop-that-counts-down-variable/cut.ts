let everythingPrinted = "";
function shownInTheText(value: unknown): string { return (typeof value === "object" && value !== null) || typeof value === "function" || typeof value === "symbol" ? typeof value : String(value); }
function printValue(...values: unknown[]): void { for (const value of values) everythingPrinted += shownInTheText(value) + " "; everythingPrinted += "\n"; }
    let out = "";
    function look1(c: any): void {
        let sum: any = 0;
        // @ts-ignore
        for (let index = c.length - 1; index >= 0; index--) {
        // @ts-ignore
            out += ((c[index] as unknown as any) && "and") + ",";
        // @ts-ignore
            sum += c[index] % 3;
        }
        // @ts-ignore
        out += " " + sum + "; ";
    }
    // @ts-ignore
    for (const line of ["[65536,1,100,1e-7]", "[0.5,1e-7,0.25,3]", "[4294967296,-2147483648]", "[true,-1,2.5,7]", "[-0.5,3]"]) {
        // @ts-ignore
        look1(JSON.parse(line).filter(() => true));
    }
    // @ts-ignore
    printValue("parsed 1", out);
