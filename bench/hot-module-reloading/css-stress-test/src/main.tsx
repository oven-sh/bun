export const Main = ({ productName, cssInJS }) => {
  return (
    <>
      <header>
        <div className="Title">CSS HMR Stress Test!</div>
        <p className="Description">
          This page visually tests how quickly a bundler can update{" "}
          {cssInJS ? "CSS-in-JS" : "CSS"} over Hot Module Reloading.
        </p>
      </header>
      <main className="main">
        <section className="ProgressSection">
          <p className="Subtitle">
            <span className="Subtitle-part ran">
              Ran: <span className="timer"></span>
            </span>
          </p>

          <div className="ProgressBar-container">
            <div className="ProgressBar"></div>
          </div>
          <div className="SectionLabel">
            The progress bar should move from left to right smoothly.
          </div>
        </section>

        <section>
          <div className="Spinners">
            <div className="Spinner-container Spinner-1">
              <div className="Spinner"></div>
            </div>

            <div className="Spinner-container Spinner-2">
              <div className="Spinner"></div>
            </div>

            <div className="Spinner-container Spinner-3">
              <div className="Spinner"></div>
            </div>

            <div className="Spinner-container Spinner-4">
              <div className="Spinner"></div>
            </div>
          </div>
          <div className="SectionLabel">
            The spinners should rotate &amp; change color smoothly.
          </div>
        </section>
      </main>
      <footer>
        <div className="SectionLabel FooterLabel">
          There are no CSS animations on this page.
        </div>

        <div className="Bundler-container">
          <div className="Bundler">{productName}</div>
          <div className="Bundler-updateRate">
            {cssInJS ? "CSS-in-JS framework: " + cssInJS : ""}
          </div>
        </div>
      </footer>
    </>
  );
};
