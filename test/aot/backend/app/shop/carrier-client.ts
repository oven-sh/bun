import * as z from "zod";
import type { Country, Rate } from "./types";

const carrier = process.env.CARRIER_URL ?? "http://127.0.0.1:3001";

const ratesSchema = z.object({
  carrier: z.string(),
  currency: z.literal("EUR"),
  rates: z.array(z.object({ service: z.string(), cents: z.int().nonnegative(), days: z.int().positive() })),
});

export async function shippingRates(country: Country, grams: number): Promise<Rate[]> {
  const response = await fetch(`${carrier}/rates?country=${country}&grams=${grams}`);
  if (!response.ok) throw new Error(`The carrier answered ${response.status}`);
  return ratesSchema.parse(await response.json()).rates;
}
