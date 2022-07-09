// Get Write from Bun.
const { write } = Bun;
const BunYoutubeScraper = async (url, saveJson) => {
  // GET the HTML of the page.
  const body = await fetch(url);
  // Parse the HTML.
  const html = await body.text();
  // Scrape the HTML.
  const videoUrl = url;
  const title = html.match(/title="(.*?)"/g)[2].split("\"")[1];
  const videoId = html.match(/meta itemprop="videoId" content="(.*?)"/g)[0].split("\"")[3];
  const description = html.match(/description":{"simpleText":"(.*?)"/g)[0].split("\"")[4].replace(/\\n/g, " ").replace(/\\"/g, "\"");
  const videoThumbnail = html.match(/meta property="og:image" content="(.*?)"/g)[0].split("\"")[3];
  const approxDurationMs = html.match(/approxDurationMs":"(.*?)"/g)[0].split(":")[1].split("\"")[1];
  const datePublished = html.match(/meta itemprop="datePublished" content="(.*?)"/g)[0].split("\"")[3];
  const uploadDate = html.match(/meta itemprop="uploadDate" content="(.*?)"/g)[0].split("\"")[3];
  const viewCount = html.match(/{"viewCount":{"simpleText":"(.*?)"/g)[0].split("\"")[5];
  const likesCount = html.match(/defaultText":{"accessibility":{"accessibilityData":{"label":"(.*?)"/g)[0].split("\"")[8];
  const keywords = html.match(/meta name="keywords" content="(.*?)"/g)[0].split("\"")[3];
  // Create the JSON object with the scraped data.
  const videoDataObject = {
    title,
    videoId,
    videoUrl,
    description,
    videoThumbnail,
    approxDurationMs,
    datePublished,
    uploadDate,
    viewCount,
    likesCount,
    keywords,
  }
  // Save the data.
  let saveVideoDataJson = saveJson;
  if (saveVideoDataJson) {
    await write(`${videoId}.json`, JSON.stringify(videoDataObject));
    console.log('\x1b[32m%s\x1b[0m', 'The data has been saved, in the file: ' + `./${videoId}.json`);
  } else {
    console.log('\x1b[31m%s\x1b[0m', 'The data not saved to json file because the saveJson parameter is false!!.');
  }
  // Return the scraped data.
  return {
    ...videoDataObject
  }
}
// Tell BunYoutubeScraper (BYS) that save the data in a json file.
const saveJson = true;
// Tell BunYoutubeScraper (BYS) that the url to scrape is https://www.youtube.com/watch?v=)
const bys = await BunYoutubeScraper("https://www.youtube.com/watch?v=dJpSTPUVKQU", saveJson);
// Check time of execution.
console.time();
for (let i = 0; i < 100000; i++) {};
console.timeEnd();