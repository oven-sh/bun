import { CommitMessages } from "../../command/CommitMessages.ts";
import { type PipelineOptions } from "./Pipeline.ts";

export class PipelineOptionsBuilder<Build extends { id: string }> {
  private skip: {
    all: boolean;
    build: boolean;
    tests: boolean;
    images: {
      build: boolean;
      publish: boolean;
    };
  };
  public forceBuild: boolean;
  public ciFileChanged: boolean;
  public lastBuild: Build | undefined;
  public changedFiles: string[];
  public buildRelease: boolean;

  constructor(lastBuild: Build | undefined, changedFiles: string[], buildRelease: boolean) {
    this.lastBuild = lastBuild;
    this.changedFiles = changedFiles;
    this.buildRelease = buildRelease;

    let { forceBuild, ciFileChanged } = CommitMessages.force(this);
    {
      this.forceBuild = forceBuild ?? false;
      this.ciFileChanged = ciFileChanged ?? false;
    }

    let skipAll = CommitMessages.skipCi(this);
    let skipBuild = CommitMessages.skipBuild(this);
    let skipTests = CommitMessages.skipTests();
    let buildImages = CommitMessages.buildImages(this);
    let publishImages: boolean | undefined;
    ({ buildImages, publishImages } = CommitMessages.publishImages(this));
    {
      this.skip = {
        all: skipAll || false,
        build: skipBuild || false,
        tests: skipTests || false,
        images: {
          build: buildImages || false,
          publish: publishImages || false,
        },
      };
    }
  }

  public build = (): PipelineOptions => {
    let buildId: string | undefined;
    if (this.lastBuild) {
      if (!this.forceBuild) {
        buildId = this.lastBuild.id;
      }
    }

    return {
      buildId,
      buildImages: this.skip.images.build,
      publishImages: this.skip.images.publish,
      skipTests: this.skip.tests,
    };
  };

  static for = async <Build extends { id: string }>(
    getLastBuild: () => Promise<Build | undefined>,
    getChangedFiles: () => Promise<string[]>,
    getBuildRelease: () => Promise<boolean>,
  ): Promise<PipelineOptionsBuilder<Build>> => {
    return new PipelineOptionsBuilder(await getLastBuild(), await getChangedFiles(), await getBuildRelease());
  };
}
