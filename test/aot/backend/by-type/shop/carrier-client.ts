import { JSON } from "bun"; import type { Schema } from "bun";
import type { Country, Rate } from "./types";

const carrier = process.env.CARRIER_URL ?? "http://127.0.0.1:3001";

interface RatesAnswer {
  carrier: string;
  currency: "EUR";
  rates: { service: string; cents: number & Schema.Int & Schema.Min<0>; days: number & Schema.Int & Schema.Min<1> }[];
}

export async function shippingRates(country: Country, grams: number): Promise<Rate[]> {
  const response = await fetch(`${carrier}/rates?country=${country}&grams=${grams}`);
  if (!response.ok) throw new Error(`The carrier answered ${response.status}`);
  return JSON.parse<RatesAnswer>(await response.text()).rates;
}
