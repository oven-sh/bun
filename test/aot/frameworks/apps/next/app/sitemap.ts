import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["first", "second"].map(slug => ({ url: "https://example.test/post/" + slug, changeFrequency: "weekly" as const, priority: 0.5 }));
}
