---
name: Deploy a Bun application on Render
---

[Render](https://render.com/) is a cloud platform that lets you flexibly build, deploy, and scale your apps.

It offers features like auto deploys from GitHub, a global CDN, private networks, automatic HTTPS setup, and managed PostgreSQL and Redis instances.

Render supports Bun natively. You can deploy Bun apps as web services, background workers, cron jobs, and more.

---

As an example, let's deploy a simple Express HTTP server to Render.

---

Create a new GitHub repo named `myapp`. Git clone it locally.

```bash
git clone git@github.com:my-github-username/myapp.git
cd myapp
```

---

Add the Express library.

```bash
bun add express
```

---
Define a simple server with Express:

```app.ts
import express from "express";

const app = express();
const port = process.env.PORT || 3001;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Listening on port ${port}...`);
});
```

---
Commit your changes and push to GitHub.

```bash
git add app.ts bun.lockb package.json
git commit -m "Create simple Express app"
git push origin main
```

---

In your [Render Dashboard](https://dashboard.render.com/), click `New` > `Web Service` and connect your `myapp` repo.

---

In the Render UI, provide the following values during web service creation:

|             |           |
| ----------- | --------- |
| **Runtime** | `Node` |
| **Build Command** | `bun install` |
| **Start Command** | `bun app.js` |

---

That's it! Your web service will be live at its `onrender.com` URL as soon as the build finishes.

Visit the URL to see the "Hello world!" message.