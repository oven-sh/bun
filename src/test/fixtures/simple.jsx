import { Link } from "../routes";
import Head from "../components/head";
import Nav from "../components/nav";
import withRedux from "next-redux-wrapper";
import Header from "../components/Header";
import Button from "../components/Button";
import cookies from "next-cookies";
import Text from "../components/Text";
import _ from "lodash";
import { updateEntities, setCurrentUser, initStore } from "../redux/store";
import { getFeaturedProfiles, getCurrentUser } from "../api";
import { bindActionCreators } from "redux";
import { Router } from "../routes";
import PageFooter from "../components/PageFooter";
import withLogin from "../lib/withLogin";
import qs from "qs";
import LazyLoad from "react-lazyload";
import { buildImgSrcSet } from "../lib/imgUri";
import { buildProfileURL } from "../lib/routeHelpers";
import LoginGate, { LOGIN_STATUSES } from "../components/LoginGate";
import Divider from "../components/Divider";
import { SPACING } from "../helpers/styles";

const FeaturedProfile = ({ profile }) => {
  return (
    <Link route={buildProfileURL(profile.id)}>
      <a className="Profile">
        <img
          src={_.first(profile.photos)}
          srcSet={buildImgSrcSet(_.first(profile.photos), 250)}
        />
        <div className="Text">
          <div className="Title">
            <Text
              font="sans-serif"
              lineHeight="20px"
              weight="semiBold"
              size="18px"
              color="#000"
            >
              {profile.name}
            </Text>
          </div>

          <div className="Tagline">
            <Text size="14px">{(profile.tagline || "").substr(0, 100)}</Text>
          </div>
        </div>
        <style jsx>{`
          .Profile {
            background-color: #ffffff;
            cursor: pointer;
            text-decoration: none;
            text-align: left;
            width: 100%;
            height: 100%;
            border-radius: 6px;
            display: flex;
            flex-shrink: 0;
            flex-grow: 0;
            flex-direction: column;
          }

          .Text {
            flex: 1;
          }

          .Profile:hover img {
            opacity: 0.85;
          }

          .Title {
            margin-top: 1rem;
            margin-bottom: 0.5rem;
          }

          .Tagline {
            margin-bottom: 1.5rem;
          }

          img {
            object-fit: cover;
            flex: 0 0 250px;
            flex-shrink: 0;
            display: flex;
            width: 250px;
            height: 250px;
            opacity: 1;
            transition: opacity 0.1s linear;
          }

          @media (max-width: 500px) {
            .Profile {
              margin-bottom: 2em;
            }
          }
        `}</style>
      </a>
    </Link>
  );
};

class SignupForm extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      email: this.props.email || "",
    };
  }

  setEmail = (evt) => this.setState({ email: evt.target.value });

  componentDidMount() {
    Router.prefetchRoute(`/sign-up/verify`);
  }

  handleSubmit = (evt) => {
    evt.preventDefault();

    Router.pushRoute(
      `/sign-up/verify?${qs.stringify({ email: this.state.email })}`,
    );
  };

  render() {
    return (
      <form onSubmit={this.handleSubmit}>
        <input
          type="email"
          name="email"
          autoComplete="email"
          onChange={this.setEmail}
          placeholder="Your email"
          value={this.state.email}
        />
        <Button componentType="button" inline>
          CREATE MY PAGE
        </Button>

        <style jsx>{`
          form {
            display: flex;
          }

          input {
            font-size: 14px;
            padding: 14px 22px;
            border-radius: 33px;
            border-top-right-radius: 0;
            border-bottom-right-radius: 0;
            border: 1px solid #bababa;
            border-right: 0px;
            line-height: 18px;
            color: #000;
            outline: none;
            width: auto;
            display: flex;
            flex: 1;
          }

          input::-webkit-input-placeholder {
            color: #c5cbd4;
          }

          input:focus {
            border-color: #b0b0b0;
          }
        `}</style>
      </form>
    );
  }
}

class Homepage extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      isLoadingProfiles: true,
      profiles: [],
    };
  }

  static async getInitialProps(ctx) {
    if (ctx.isServer && ctx.req.path === "/") {
      const { currentUserId } = cookies(ctx);

      if (currentUserId) {
        ctx.res.writeHead(302, {
          Location: `${process.env.DOMAIN}/welcome`,
        });

        ctx.res.end();
        ctx.res.finished = true;
      }
    }
  }

  async componentDidMount() {
    const profileResponse = await getFeaturedProfiles();
    this.props.updateEntities(profileResponse.body);

    this.setState({
      isLoadingProfiles: false,
      profiles: profileResponse.body.data,
    });

    Router.prefetchRoute(`/lucy`);
  }

  render() {
    return (
      <div>
        <Head
          title="Apply to Date – your own game of The Bachelor(ette)"
          url={`${process.env.DOMAIN}/`}
          disableGoogle={false}
        />
        <Header />
        <article>
          <main>
            <div className="Copy">
              <img className="Logo Logo-Home" src="/static/animatedlogo.gif" />
              <div className="Copy-title">
                <Text font="serif" size="36px" lineHeight="44px" weight="bold">
                  Your own game of The Bachelor(ette)
                </Text>
              </div>
              <div className="Copy-body">
                <Text size="16px" lineHeight="24px" font="sans-serif">
                  Create a page where people apply to go on a date with you. You
                  pick the winners.
                </Text>
              </div>

              {!this.props.currentUserId && <SignupForm />}

              <div className="AppStoreContainer">
                <Divider height={`${SPACING.normal}px`} color="transparent" />
                <a
                  className="AppStore AppStore--ios"
                  target="_blank"
                  href="https://itunes.apple.com/us/app/apply-to-date/id1357419725?mt=8"
                >
                  <img src="https://devimages-cdn.apple.com/app-store/marketing/guidelines/images/badge-download-on-the-app-store.svg" />
                </a>

                <a
                  target="_blank"
                  className="AppStore AppStore--android"
                  href="https://play.google.com/store/apps/details?id=com.shipfirstlabs.applytodate&utm_source=homepage&pcampaignid=MKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1"
                >
                  <img
                    alt="Get it on Google Play"
                    src="https://play.google.com/intl/en_us/badges/images/generic/en_badge_web_generic.png"
                  />
                </a>
              </div>
            </div>
          </main>
        </article>

        <footer>
          <div className="divider" />

          <Text size="36px" font="sans-serif" color="#000">
            Featured pages
          </Text>

          <div className="FeaturedProfiles-wrapper">
            {this.state.isLoadingProfiles && <div className="Spinner" />}
            <div className="FeaturedProfiles">
              {!_.isEmpty(this.state.profiles) &&
                this.state.profiles.map((profile) => (
                  <FeaturedProfile key={profile.id} profile={profile} />
                ))}
            </div>
          </div>
        </footer>

        <article>
          <PageFooter center />
        </article>
        <style jsx>{`
          article {
            max-width: 710px;
            margin-left: auto;
            margin-right: auto;
            padding-left: 14px;
            padding-right: 14px;
            overflow-x: hidden;
          }

          main {
            display: flex;
            margin-top: 6rem;
            margin-bottom: 6rem;

            justify-content: center;
          }

          footer {
            display: flex;
            flex-direction: column;
            text-align: center;
            overflow-x: hidden;
          }

          .divider {
            height: 2px;
            width: 269px;
            margin-bottom: 6rem;
            margin-left: auto;
            margin-right: auto;
            background-color: #0aca9b;
          }

          .Logo-Home {
            margin-left: auto;
            margin-right: auto;
            width: 97px;
            height: 152.02px;
            margin-bottom: 28px;
          }

          .Copy {
            max-width: 710px;
            margin: 0 auto;
            text-align: center;
          }

          .Copy-body {
            margin-top: 1rem;
            margin-bottom: 2rem;
            font-weight: 200;
          }

          .FeaturedProfiles-wrapper {
            padding-top: 4rem;
            padding-bottom: 6rem;
            padding-left: 28px;
            padding-right: 28px;

            overflow-x: auto;
            width: 100vw;
          }

          .Spinner {
            display: flex;
            content: "";
            margin: 84px auto;
            height: 28px;
            width: 28px;
            animation: rotate 0.8s infinite linear;
            border: 4px solid #4be1ab;
            border-right-color: transparent;
            border-radius: 50%;
          }

          .AppStoreContainer {
            display: flex;
            justify-content: center;
            align-items: center;
          }

          .AppStore--ios img {
            width: 180px;
          }

          .AppStore--android img {
            width: 230px;
          }

          @keyframes rotate {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          .FeaturedProfiles {
            display: grid;
            grid-column-gap: 2rem;
            grid-row-gap: 2rem;
            text-align: center;
            justify-content: center;
            margin-left: auto;
            margin-right: auto;
            grid-template-columns: 250px 250px 250px 250px;
          }

          @media (max-width: 1100px) {
            .FeaturedProfiles {
              grid-template-columns: 250px 250px 250px;
            }
          }

          @media (max-width: 900px) {
            .FeaturedProfiles {
              grid-template-columns: 250px 250px;
            }
          }

          @media (max-width: 554px) {
            .FeaturedProfiles-wrapper {
              padding-left: 14px;
              padding-right: 14px;
            }

            .AppStoreContainer {
              flex-direction: column;
            }

            .FeaturedProfiles {
              grid-auto-flow: row dense;
              grid-auto-rows: auto;
              grid-template-columns: 250px;
              grid-template-rows: 1fr;
              justify-content: center;
            }
          }
        `}</style>
      </div>
    );
  }
}

const HomepageWithStore = withRedux(initStore, null, (dispatch) =>
  bindActionCreators({ updateEntities, setCurrentUser }, dispatch),
)(LoginGate(Homepage));

export default HomepageWithStore;
