import type { Int, Min } from "bun";
import type { Country, Rate } from "./types";

const carrier = process.env.CARRIER_URL ?? "http://127.0.0.1:3001";

interface RatesAnswer {
  carrier: string;
  currency: "EUR";
  rates: { service: string; cents: number & Int & Min<0>; days: number & Int & Min<1> }[];
}

export async function shippingRates(country: Country, grams: number): Promise<Rate[]> {
  const response = await fetch(`${carrier}/rates?country=${country}&grams=${grams}`);
  if (!response.ok) throw new Error(`The carrier answered ${response.status}`);
  return Bun.validate<RatesAnswer>(await response.json()).rates;
}
