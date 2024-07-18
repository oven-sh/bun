---
name: Deploy a Bun application on Heroku
---

[Heroku](https://www.heroku.com/) is a cloud platform that lets you flexibly build, deploy, and scale your apps. It offers features like auto deploys from GitHub, automatic HTTPS setup, and managed PostgreSQL and Redis. Be aware that deploying to Heroku is not free, but can be as low as $5/month.

Bun is not an _officially_ supported language on Heroku, but can easily be used via [a custom Buildpack](https://github.com/jakeg/heroku-buildpack-bun).

---

As an example, we'll deploy a simple HTTP server to Heroku on every push to the `main` branch from a GitHub repo. This assumes you already have a [GitHub account](https://github.com/signup) and a [Heroku account](https://signup.heroku.com/). For this guide we'll make a new repo using the GitHub.com web interface, but any new or existing GitHub repo will do.

[Create a new repo](https://github.com/new) on GitHub, calling it eg `bun-hello-world` and ticking 'Add a README file'.

In the new repo, click the '+' button then 'Create new file', naming it `index.js`.

Enter the following code into `index.js`:

```js#index.js
import { env } from 'process'

let count = 0;
const start = Date.now();

const server = Bun.serve({
  port: env.PORT || 3000, // Heroku expects your app to bind to env.PORT
  fetch(request) {
    return new Response(`<!doctype html>
      <h1>Welcome to Bun, running on Heroku!</h1>
      <p>${ ++count } hits since the last Dyno restart ${ Math.round((Date.now() - start)/1000) }s ago.</p>
    `, { headers: { "Content-Type": "text/html" } } );
  },
});

console.log(`Listening on localhost:${server.port}`);
```

'Commit changes...' with the default options to save the file.

Create and save another file called `package.json` with the following (which tells Heroku how to run your app):

```json#package.json
{
  "scripts": {
    "start": "bun index.js"
  }
}
```

Next, we'll create an app on Heroku and connect it to your repo.

From your Heroku dashboard, 'Create new app' and give your app a name and choose a region.

From the 'Deploy' tab in your newly created app, under 'Deployment method' choose 'GitHub'.

Use the search to find your `bun-hello-world` repo and 'Connect' to it.

Under 'Automatic deploys' click 'Enable Automatic Deploys'.

Go to the 'Settings' tab and under 'Buildpacks' click 'Add buildpack'. Paste the URL `https://github.com/jakeg/heroku-buildpack-bun`, which is a custom Buildpack needed for Bun.

Return to the 'Deploy' tab and under 'Manual deploy' click 'Deploy Branch'.

You should see the message 'Your app was successfully deployed'. Click the 'View' button below it to see your Bun app deployed on Heroku! In addition, any time you push changes to your repo they'll be automatically deployed within a few seconds.

Heroku charges for Dyno usage by your apps, so you should disable Dynos for unused apps. Do this from the 'Resources' tab by clicking the edit icon to the right of the cost per hour.

Explore [the Heroku docs](https://devcenter.heroku.com/) and your app's dashboard for things such as logs, changing the Dyno type or setting up a custom domain. You should also [read the documentation for the custom Buildpack](https://github.com/jakeg/heroku-buildpack-bun).
