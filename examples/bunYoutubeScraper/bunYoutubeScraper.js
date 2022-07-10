import { write, stdout } from "bun";
const BunYoutubeScraper = async (url) => {
  if (!url) {
    throw new Error("No url provided");
  } else if (!url.startsWith("https://") && !url.startsWith("http://")) {
    url = `https://youtube.com/watch?v=${url}`;
  } else {
    url.startsWith("https://") || url.startsWith("http://");
    url = `${url}`;
  }
  if (!url.includes("youtube.com"))
    return Promise.reject(new Error("Invalid url"));
  // Make a request to the url
  const response = await fetch(url);
  // if response is not ok, throw error
  if (!response.ok) throw Error("Scrape shield encountered!");
  // Save content of the response in a variable.
  const tags = [];
  // List of tags to scrape.
  const tagsList = [
    'meta[name="title"]',
    'meta[property="og:image"]',
    'meta[name="description"]',
    'meta[name="keywords"]',
    'meta[itemprop="datePublished"]',
    'meta[itemprop="uploadDate"]',
    'meta[itemprop="videoId"]',
  ];
  // GET the HTML of the page and push it to the tags array.
  const html = new HTMLRewriter()
    .on(tagsList, {
      element(el) {
        tags.push(el.getAttribute("content"));
      },
    })
    .transform(response)
    .text();
  const title = tags[0]; // Get the title of the video with HTMLRewriter.
  const keywords = tags[2]; // Get the keywords of the video with HTMLRewriter.
  const description = tags[1]; // Get the description of the video with HTMLRewriter.
  const videoThumbnai = tags[3]; // Get the thumbnail of the video with HTMLRewriter.
  const videoId = tags[4]; // Get the videoId of the video with HTMLRewriter.
  const uploadDate = tags[5]; // Get the uploadDate of the video with HTMLRewriter.
  const datePublished = tags[6]; // Get the datePublished of the video with HTMLRewriter.
  // Find the view counter with the result of "HTML Rewriter".
  const viewCount = await html.then(
    (text) => text.match(/{"viewCount":{"simpleText":"(.*?)"/g)[0].split('"')[5]
  );
  // Find the likes counter with the result of "HTML Rewriter".
  const likesCount = await html.then(
    (text) =>
      text
        .match(
          /defaultText":{"accessibility":{"accessibilityData":{"label":"(.*?)"/g
        )[0]
        .split('"')[8]
  );
  // Find the duration of the video with the result of "HTML Rewriter".
  const approxDurationMs = await html.then(
    (text) =>
      text
        .match(/approxDurationMs":"(.*?)"/g)[0]
        .split(":")[1]
        .split('"')[1]
  );
  // Find the large description with the result of "HTML Rewriter".
  const largeDescription = await html.then((text) =>
    text
      .match(/description":{"simpleText":"(.*?)"/g)[0]
      .split('"')[4]
      .replace(/\\n/g, " ")
      .replace(/\\"/g, '"')
  );
  // Return the data in a JSON format.
  const videoDataObject = {
    url,
    title,
    videoId,
    videoThumbnai,
    description,
    largeDescription,
    keywords,
    uploadDate,
    datePublished,
    approxDurationMs,
    viewCount,
    likesCount,
  };
  // Print the video data object to the console.
  write(stdout, JSON.stringify(videoDataObject, null, 2));
  // Return the scraped data.
  return {
    ...videoDataObject,
  };
};
// Any valid video Id "WzcCVPoX2wQ" or "https://www.youtube.com/watch?v=WzcCVPoX2wQ"
const bys = await BunYoutubeScraper("");
