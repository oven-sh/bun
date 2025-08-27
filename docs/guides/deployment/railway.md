---
name: Deploy a Bun application on Railway
---

Railway is an infrastructure platform where you can provision infrastructure, develop with that infrastructure locally, and then deploy to the cloud. It enables instant deployments from GitHub with zero configuration, automatic SSL, and built-in database provisioning.

This guide walks through deploying a Bun application with a PostgreSQL database, which is exactly what the template below provides. You can either follow this guide step-by-step or simply deploy the pre-configured template with one click:


{% raw %}

<a href="https://railway.com/deploy/bun-react-postgres?referralCode=Bun&utm_medium=integration&utm_source=template&utm_campaign=bun" target="_blank">
  <img src="https://railway.com/button.svg" alt="Deploy on Railway" />
</a>

{% /raw %}


---

**Prerequisites**:
- A Bun application ready for deployment
- A [Railway account](https://railway.app/)
- Railway CLI (for CLI deployment method)
- A GitHub account (for Dashboard deployment method)


---

## Method 1: Deploy via CLI

---

Ensure sure you have the Railway CLI installed.

```bash
bun install -g @railway/cli
```

---

Log into your Railway account. 

```bash
railway login
```
---

After successfully authenticating, initialize a new project.

```bash
# Initialize project
bun-react-postgres$ railway init
```

---

After initializing the project, add a new database and service.

```bash
# Add PostgreSQL database. Make sure to add this first!
bun-react-postgres$ railway add --database postgres

# Add your application service.
bun-react-postgres$ railway add --service bun-react-db --variables DATABASE_URL=\${{Postgres.DATABASE_URL}}
```

---

After the services have been created and connected, deploy the application to Railway. By default, services are only accessible within Railway's private network. To make your app publicly accessible, you need to generate a public domain.

```bash
# Deploy your application
bun-nextjs-starter$ railway up

# Generate public domain
bun-nextjs-starter$ railway domain
```

---

## Method 2: Deploy via Dashboard

---

Create a new project

1. Go to [Railway Dashboard](http://railway.com/dashboard?utm_medium=integration&utm_source=docs&utm_campaign=bun)
2. Click **"+ New"** → **"GitHub repo"** 
3. Choose your repository

---

Add a PostgreSQL database

1. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**

---

Connect this database to the service

1. Click your service (not the database)
2. Go to **"Variables"** tab
3. Click **"+ New Variable"** → **"Add Reference"**
4. Select `DATABASE_URL` from postgres

---

Generate a public domain

1. Select your service
2. Go to **"Settings"** tab
3. Under **"Networking"**, click **"Generate Domain"**

---

Your app is now live! Railway auto-deploys on every GitHub push.

---

## Configuration (Optional)

---

By default, Railway uses [Nixpacks](https://docs.railway.com/guides/build-configuration#nixpacks-options) to automatically detect and build your Bun application with zero configuration.

However, using the [Railpack](https://docs.railway.com/guides/build-configuration#railpack) application builder provides better Bun support, and will always support the latest version of Bun. The pre-configured templates use Railpack by default.

To enable Railpack in a custom project, add the following to your `railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK"
  }
}
```

For more build configuration settings, check out the [Railway documentation](https://docs.railway.com/guides/build-configuration).