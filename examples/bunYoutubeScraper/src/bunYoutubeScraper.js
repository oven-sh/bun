const { write } = Bun;
const BunYoutubeScraper = async (url, saveJson) => {
  // Make a request to the url
  const response = await fetch(url);
  // if response is not ok, throw error
  if (!response.ok) throw Error('Scrape shield encountered!');
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
  ]
  // GET the HTML of the page and push it to the tags array.
  const html = new HTMLRewriter()
    .on(tagsList, {
      element(el) {
        tags.push(el.getAttribute('content')); 
      }
    }).transform(response).text()
  const title = tags[0]
  const keywords = tags[2]
  const description = tags[1]
  const videoThumbnai = tags[3]
  const videoId = tags[4]
  const uploadDate = tags[5]
  const datePublished = tags[6]
  const viewCount = await html.then(text => text.match(/{"viewCount":{"simpleText":"(.*?)"/g)[0].split("\"")[5])
  const likesCount = await html.then(text => text.match(/defaultText":{"accessibility":{"accessibilityData":{"label":"(.*?)"/g)[0].split("\"")[8])
  const approxDurationMs = await html.then(text => text.match(/approxDurationMs":"(.*?)"/g)[0].split(":")[1].split("\"")[1])
  const largeDescription = await html.then(text => text.match(/description":{"simpleText":"(.*?)"/g)[0].split("\"")[4].replace(/\\n/g, " ").replace(/\\"/g, "\""))
  const videoDataObject = { url, title, videoId, videoThumbnai, description, largeDescription, keywords, uploadDate, datePublished, approxDurationMs, viewCount, likesCount }
  // Save the data.
  if (saveJson) {
    await write(`${videoId}.json`, JSON.stringify(videoDataObject));
    console.log('\x1b[32m%s\x1b[0m', 'The data has been saved, in the file: ' + `./${videoId}.json`);
  } else {
    console.log('\x1b[31m%s\x1b[0m', 'The data not saved to json file because the saveJson parameter is false!!.');
  }
  // Return the scraped data.
  return { ...videoDataObject }
}
// Tell BunYoutubeScraper (BYS) that save the data in a json file.
const saveJson = true;
// Tell BunYoutubeScraper (BYS) that the url to scrape is https://www.youtube.com/watch?v=)
const bys = await BunYoutubeScraper("https://www.youtube.com/watch?v=WfPu9Jrcpuk", saveJson);
// Check time of execution.
console.time();
for (let i = 0; i < 100000; i++) { };
console.timeEnd();