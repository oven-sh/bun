export async function ask() { const tax = await import("../../tax.ts"); return tax.rate() + " " + tax.fee(); }
