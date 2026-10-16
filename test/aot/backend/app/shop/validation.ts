import * as z from "zod";

const text = (longest: number) => z.string().min(1).max(longest);

const orderSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        productId: z.int().positive(),
        quantity: z.int().min(1).max(99),
        note: z.string().max(200).optional(),
      }),
    )
    .min(1)
    .max(20),
  shipTo: z.strictObject({
    name: text(100),
    street: text(200),
    city: text(100),
    postalCode: text(16),
    country: z.enum(["PT", "JP", "US", "KE", "NO"]),
  }),
  coupon: z.string().max(20).optional(),
  giftWrap: z.boolean(),
});

export type Order = z.infer<typeof orderSchema>;

export function parseOrder(body: unknown): Order | undefined {
  const result = orderSchema.safeParse(body);
  return result.success ? result.data : undefined;
}
