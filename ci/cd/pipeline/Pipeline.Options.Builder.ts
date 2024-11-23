import { CommitMessage } from "../../command/CommitMessage";
import { PipelineOptions } from "./Pipeline.Options._";

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

  constructor(
    public lastBuild: Build | undefined,
    public changedFiles: string[],
    public buildRelease: boolean,
  ) {
    let { forceBuild, ciFileChanged } = CommitMessage.force(this);
    {
      this.forceBuild = forceBuild ?? false;
      this.ciFileChanged = ciFileChanged ?? false;
    }

    let skipAll = CommitMessage.skipCi(this);
    let skipBuild = CommitMessage.skipBuild(this);
    let skipTests = CommitMessage.skipTests();
    let buildImages = CommitMessage.buildImages(this);
    let publishImages: boolean | undefined;
    ({ buildImages, publishImages } = CommitMessage.publishImages(this));
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
