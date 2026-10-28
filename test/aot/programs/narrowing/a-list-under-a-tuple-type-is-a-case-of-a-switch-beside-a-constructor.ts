// @ts-ignore
const v: [number, string] = [-2115181073, 3221225475, -1267438535];
try { console.log("keys", Object.keys(v).join()); } catch { console.log("keys threw"); }
try {
    switch (v) {
        // @ts-ignore
        case WeakMap:
    }
} catch (e) {
}
try { console.log("length", v?.length); } catch { console.log("length threw"); }
