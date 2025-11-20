/**
 * Test whether the current user has access to the Bun build-cache.
 *
 * Exits with code 0 if access is available, or 1 otherwise.
 */
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { CredentialsProviderError } from "@aws-sdk/property-provider";

class CacheConfig {
  #bucket: string;
  #region: string;

  get bucket(): string {
    return this.#bucket;
  }

  get region(): string {
    return this.#region;
  }

  static fromArgv(): CacheConfig {
    const cacheConfig = new CacheConfig();

    const exitWithHelp = (reason: string) => {
      console.error(`Error: ${reason}\n`);
      console.error("Usage: have-access --bucket <bucket-name> --region <region>");
      process.exit(1);
    };

    for (let i = 2; i < process.argv.length; i++) {
      switch (process.argv[i]) {
        case "-b":
        case "--bucket":
          cacheConfig.#bucket = process.argv[++i];
          break;
        case "-r":
        case "--region":
          cacheConfig.#region = process.argv[++i];
          break;
        default:
          exitWithHelp(`Unknown argument: ${process.argv[i]}`);
      }
    }

    if (!cacheConfig.#bucket) {
      exitWithHelp("Missing required argument: --bucket");
    }

    if (!cacheConfig.#region) {
      exitWithHelp("Missing required argument: --region");
    }

    return cacheConfig;
  }
}

/**
 * Test whether the current user has access to the Bun build-cache.
 */
async function currentUserHasAccess(cacheConfig: CacheConfig): Promise<boolean> {
  const s3Client = new S3Client({ region: cacheConfig.region });

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: cacheConfig.bucket }));
    return true;
  } catch (error) {
    if (
      error.name === "NotFound" ||
      error.$metadata?.httpStatusCode === 404 ||
      error.name === "Forbidden" ||
      error.$metadata?.httpStatusCode === 403 ||
      error instanceof CredentialsProviderError
    ) {
      return false;
    }

    throw error;
  }
}

const ok = await currentUserHasAccess(CacheConfig.fromArgv());
process.exit(ok ? 0 : 1);
