---
name: Extract social share images and Open Graph tags
---

## Extract social share images and Open Graph tags

Bun's [HTMLRewriter](https://bun.sh/docs/api/html-rewriter) API can be used to efficiently extract social share images and Open Graph metadata from HTML content. This is particularly useful for building link preview features, social media cards, or web scrapers. We can use HTMLRewriter to match CSS selectors to HTML elements, text, and attributes we want to process.

```ts
interface SocialMetadata {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
  type?: string;
}

async function extractSocialMetadata(url: string): Promise<SocialMetadata> {
  const metadata: SocialMetadata = {};
  const response = await fetch(url);

  const rewriter = new HTMLRewriter()
    // Extract Open Graph meta tags
    .on('meta[property^="og:"]', {
      element(el) {
        const property = el.getAttribute("property");
        const content = el.getAttribute("content");
        if (property && content) {
          // Convert "og:image" to "image" etc.
          const key = property.replace("og:", "") as keyof SocialMetadata;
          metadata[key] = content;
        }
      },
    })
    // Extract Twitter Card meta tags as fallback
    .on('meta[name^="twitter:"]', {
      element(el) {
        const name = el.getAttribute("name");
        const content = el.getAttribute("content");
        if (name && content) {
          const key = name.replace("twitter:", "") as keyof SocialMetadata;
          // Only use Twitter Card data if we don't have OG data
          if (!metadata[key]) {
            metadata[key] = content;
          }
        }
      },
    })
    // Fallback to regular meta tags
    .on('meta[name="description"]', {
      element(el) {
        const content = el.getAttribute("content");
        if (content && !metadata.description) {
          metadata.description = content;
        }
      },
    })
    // Fallback to title tag
    .on("title", {
      text(text) {
        if (!metadata.title) {
          metadata.title = text.text;
        }
      },
    });

  // Process the response
  await rewriter.transform(response).blob();

  // Convert relative image URLs to absolute
  if (metadata.image && !metadata.image.startsWith("http")) {
    try {
      metadata.image = new URL(metadata.image, url).href;
    } catch {
      // Keep the original URL if parsing fails
    }
  }

  return metadata;
}

// Example usage
const metadata = await extractSocialMetadata("https://bun.sh");
console.log(metadata);
// {
//   title: "Bun — A fast all-in-one JavaScript runtime",
//   description: "Bundle, transpile, install and run JavaScript & TypeScript projects — all in Bun. Bun is a fast all-in-one JavaScript runtime & toolkit designed for speed, complete with a bundler, test runner, and Node.js-compatible package manager.",
//   image: "https://bun.sh/share.jpg",
//   type: "website",
//   ...
// }
```
